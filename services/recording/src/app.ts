import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createS3Storage, type RecordingStorage } from './storage.js';
import { FEATURE_MIN_PLAN } from '../../../shared/entitlements.cjs';

export const MAX_RECORDING_BYTES = 80 * 1024 * 1024;
interface Identity { sub: string; tenantId: string }
interface Meeting { hostId: string | null; status: string; settings?: { allowRecording?: boolean; recording_allowed?: boolean; e2eeRequired?: boolean } }
interface Options {
    storage?: RecordingStorage;
    authenticate?: (authorization: string) => Promise<Identity | null>;
    authorizeFeature?: (authorization: string | undefined, feature: string) => Promise<'allow' | 'deny' | 'unauthorized'>;
    meeting?: (code: string) => Promise<Meeting | null>;
    maxUploadBytes?: number;
}
const codePattern = /^[A-Z0-9-]{1,30}$/;
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
const parse = (value: { body: Uint8Array } | null) => value ? JSON.parse(Buffer.from(value.body).toString('utf8')) : null;

async function authenticate(authorization: string): Promise<Identity | null> {
    const base = process.env.AUTH_INTERNAL_URL || 'http://localhost:4002';
    const response = await fetch(`${base}/api/auth/verify`, { headers: { Authorization: authorization }, signal: AbortSignal.timeout(5000) });
    if (response.status === 401) return null;
    if (!response.ok) throw new Error('Authentication unavailable');
    const result = await response.json() as { valid?: boolean; payload?: Identity };
    if (!result.valid || typeof result.payload?.sub !== 'string' || typeof result.payload.tenantId !== 'string') return null;
    return result.payload;
}
async function loadMeeting(code: string): Promise<Meeting | null> {
    const base = process.env.MEETING_INTERNAL_URL || 'http://localhost:4003';
    const response = await fetch(`${base}/api/meetings/code/${encodeURIComponent(code)}`, { signal: AbortSignal.timeout(5000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Meeting unavailable');
    const value = await response.json() as Meeting;
    if (typeof value.hostId !== 'string' && value.hostId !== null) throw new Error('Invalid meeting response');
    return value;
}

async function authorizeFeature(authorization: string | undefined, feature: string): Promise<'allow' | 'deny' | 'unauthorized'> {
    const base = process.env.AUTH_INTERNAL_URL || 'http://localhost:4002';
    const response = await fetch(`${base}/api/auth/me/entitlements`, {
        headers: authorization ? { Authorization: authorization } : {},
        signal: AbortSignal.timeout(5000),
    });
    if (response.status === 401) return 'unauthorized';
    if (!response.ok) throw new Error('Entitlements unavailable');
    const entitlements = await response.json() as { features?: unknown };
    return Array.isArray(entitlements.features) && entitlements.features.includes(feature) ? 'allow' : 'deny';
}

export function createRecordingApp(options: Options = {}) {
    const app = express();
    const bucket = process.env.RECORDING_BUCKET;
    const storage = options.storage || (bucket ? createS3Storage(bucket) : undefined);
    const verify = options.authenticate || authenticate;
    const authorize = options.authorizeFeature || authorizeFeature;
    const meeting = options.meeting || loadMeeting;
    const maxBytes = options.maxUploadBytes || MAX_RECORDING_BYTES;
    let uploads = 0;
    app.disable('x-powered-by');
    app.use(cors({ origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173'], methods: ['GET', 'POST', 'DELETE'], credentials: true }));
    app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
    app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'qsvc-recording', recordingEnabled: !!storage }));
    app.use('/api', rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false }));
    app.use('/api', (_req, res, next) => storage ? next() : res.status(503).json({ code: 'RECORDING_UNAVAILABLE', error: 'Cloud recording storage is not configured.' }));

    const route = (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { handler(req, res).catch(next); };
    const identity = async (req: Request, res: Response) => {
        const authorization = req.headers.authorization;
        if (!authorization?.startsWith('Bearer ')) { res.status(401).json({ error: 'Sign in to manage recordings.' }); return null; }
        const user = await verify(authorization);
        if (!user || !user.sub || !user.tenantId) { res.status(401).json({ error: 'Your session expired. Sign in again.' }); return null; }
        return user;
    };
    const owner = async (req: Request, res: Response) => {
        const authorization = req.headers.authorization;
        const access = await authorize(typeof authorization === 'string' ? authorization : undefined, 'cloud_recording');
        if (access === 'unauthorized') { res.status(401).json({ error: 'Your session expired. Sign in again.' }); return null; }
        if (access === 'deny') {
            res.status(403).json({ code: 'UPGRADE_REQUIRED', requiredPlan: FEATURE_MIN_PLAN.cloud_recording });
            return null;
        }
        const user = await identity(req, res);
        if (!user) return null;
        const code = String(req.params.meetingCode);
        if (!codePattern.test(code)) { res.status(400).json({ error: 'Invalid meeting code.' }); return null; }
        const value = await meeting(code);
        if (!value || value.hostId !== user.sub) { res.status(404).json({ error: 'Meeting not found.' }); return null; }
        // Hashing keeps caller-provided identity strings out of storage paths.
        return { user, meeting: value, code, prefix: `recordings/${hash(user.tenantId)}/${hash(user.sub)}/${code}/` };
    };
    const locate = async (req: Request, res: Response) => {
        const scope = await owner(req, res);
        if (!scope) return null;
        const id = String(req.params.id);
        if (!idPattern.test(id)) { res.status(400).json({ error: 'Invalid recording.' }); return null; }
        for (const format of ['webm', 'mp4']) {
            const key = `${scope.prefix}${id}.${format}`;
            const item = await storage!.head(key);
            if (item) return { ...scope, key, id, format, item, marker: `${scope.prefix}${id}.share.json` };
        }
        res.status(404).json({ error: 'Recording not found.' });
        return null;
    };

    app.get('/api/recordings/shared/:token', route(async (req, res) => {
        const token = String(req.params.token);
        if (!tokenPattern.test(token)) return res.status(404).json({ error: 'Share link not found.' });
        const tokenHash = hash(token);
        const pointer = parse(await storage!.get(`shares/${tokenHash}.json`));
        if (!pointer) return res.status(404).json({ error: 'Share link not found.' });
        const marker = parse(await storage!.get(pointer.marker));
        const item = marker?.tokenHash === tokenHash ? await storage!.head(pointer.key) : null;
        if (!item) return res.status(404).json({ error: 'This recording is no longer shared.' });
        return res.json({ url: await storage!.playback(pointer.key), expiresIn: 300, recording: { id: pointer.id, meetingCode: pointer.meetingCode, format: pointer.format, createdAt: item.modified.toISOString(), size: item.size } });
    }));
    app.get('/api/recordings/meeting/:meetingCode', route(async (req, res) => {
        const scope = await owner(req, res);
        if (!scope) return;
        const cursor = req.query.cursor;
        if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 4096)) return res.status(400).json({ error: 'Invalid page cursor.' });
        const page = await storage!.list(scope.prefix, cursor as string | undefined);
        return res.json({ recordings: page.objects.flatMap(item => {
            const name = item.key.slice(scope.prefix.length);
            const [id, format] = name.split('.');
            return idPattern.test(id) && ['mp4', 'webm'].includes(format) && name === `${id}.${format}`
                ? [{ id, meetingCode: scope.code, createdAt: item.modified.toISOString(), size: item.size, format }] : [];
        }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), nextCursor: page.nextCursor || null });
    }));
    app.post('/api/recordings/:meetingCode', route(async (req, res) => {
        const scope = await owner(req, res);
        if (!scope) return;
        const settings = scope.meeting.settings;
        // The final upload can arrive after the host ends the live meeting.
        if (scope.meeting.status === 'cancelled' || settings?.allowRecording === false || settings?.recording_allowed === false || settings?.e2eeRequired) {
            return res.status(403).json({ error: 'Recording is not allowed for this meeting.' });
        }
        const type = req.headers['content-type']?.split(';')[0].trim();
        if (type !== 'video/webm' && type !== 'video/mp4') return res.status(415).json({ error: 'Upload a WebM or MP4 recording.' });
        const requestedId = req.get('X-Recording-Id');
        if (requestedId !== undefined && !idPattern.test(requestedId)) return res.status(400).json({ error: 'Invalid recording upload identifier.' });
        if (uploads >= 2) return res.status(503).json({ error: 'Recording uploads are busy. Try again shortly.' });
        uploads++;
        let released = false;
        const release = () => { if (!released) { released = true; uploads--; } };
        res.once('finish', release); res.once('close', release);
        const readBody = express.raw({ type: () => true, limit: maxBytes, inflate: false });
        await new Promise<void>((resolve, reject) => readBody(req, res, error => error ? reject(error) : resolve()));
        const body: Buffer = req.body;
        const isVideo = Buffer.isBuffer(body) && body.length >= 12 && (type === 'video/webm'
            ? body.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) : body.toString('ascii', 4, 8) === 'ftyp');
        if (!isVideo) return res.status(415).json({ error: 'The uploaded file is not a supported recording.' });
        const id = requestedId || randomUUID(), format = type === 'video/mp4' ? 'mp4' : 'webm';
        const key = `${scope.prefix}${id}.${format}`;
        try { await storage!.put(key, body, type, true); }
        catch (error) {
            const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
            if (status !== 412) throw error;
            const existing = await storage!.head(key);
            if (!existing || existing.size !== body.length || existing.type !== type) return res.status(409).json({ error: 'Recording identifier already belongs to another upload.' });
            return res.status(200).json({ id, meetingCode: scope.code, createdAt: existing.modified.toISOString(), size: existing.size, format });
        }
        return res.status(201).json({ id, meetingCode: scope.code, createdAt: new Date().toISOString(), size: body.length, format });
    }));
    app.get('/api/recordings/:meetingCode/:id/playback', route(async (req, res) => {
        const recording = await locate(req, res);
        if (recording) return res.json({ url: await storage!.playback(recording.key), expiresIn: 300 });
    }));
    const revoke = async (markerKey: string) => {
        const marker = parse(await storage!.get(markerKey));
        // Remove the authoritative marker first, so a partial cleanup revokes access.
        await storage!.remove(markerKey);
        if (marker?.tokenHash) await storage!.remove(`shares/${marker.tokenHash}.json`);
    };
    app.post('/api/recordings/:meetingCode/:id/share', route(async (req, res) => {
        const recording = await locate(req, res);
        if (!recording) return;
        await revoke(recording.marker);
        const token = randomBytes(32).toString('base64url'), tokenHash = hash(token);
        await storage!.put(`shares/${tokenHash}.json`, bytes({ key: recording.key, marker: recording.marker, id: recording.id, meetingCode: recording.code, format: recording.format }), 'application/json');
        await storage!.put(recording.marker, bytes({ tokenHash }), 'application/json');
        return res.json({ token });
    }));
    app.delete('/api/recordings/:meetingCode/:id/share', route(async (req, res) => {
        const recording = await locate(req, res);
        if (!recording) return;
        await revoke(recording.marker);
        return res.sendStatus(204);
    }));
    app.delete('/api/recordings/:meetingCode/:id', route(async (req, res) => {
        const recording = await locate(req, res);
        if (!recording) return;
        await storage!.remove(recording.key);
        await revoke(recording.marker);
        return res.sendStatus(204);
    }));
    app.use('/api', (_req, res) => res.status(404).json({ error: 'Recording route not found.' }));
    app.use((error: { type?: string; status?: number }, _req: Request, res: Response, _next: NextFunction) => {
        if (res.headersSent) return;
        if (error.type === 'entity.too.large') { res.status(413).json({ error: 'Recording exceeds the upload limit.' }); return; }
        if (error.status === 415) { res.status(415).json({ error: 'Compressed recording uploads are not supported.' }); return; }
        res.status(503).json({ error: 'Recording service unavailable. Try again shortly.' });
    });
    return app;
}
