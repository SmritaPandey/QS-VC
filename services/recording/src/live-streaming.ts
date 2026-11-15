import express, { type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Server } from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';

export type LiveProvider = 'youtube' | 'facebook';
type Identity = { sub: string; tenantId: string };
type Meeting = { hostId: string | null; status: string; settings?: { allowRecording?: boolean; recording_allowed?: boolean; e2eeRequired?: boolean } };
type Dependencies = {
    authenticate: (authorization: string) => Promise<Identity | null>;
    authorizeFeature: (authorization: string | undefined, feature: string) => Promise<'allow' | 'deny' | 'unauthorized'>;
    meeting: (code: string) => Promise<Meeting | null>;
    environment?: NodeJS.ProcessEnv;
    encoderAvailable?: () => boolean;
    startEncoder?: (destination: string) => ChildProcessWithoutNullStreams;
};
type Ticket = { code: string; provider: LiveProvider; authorization: string; user: Identity; expires: number };
const CHUNK_LIMIT = 2 * 1024 * 1024, BUFFER_LIMIT = 4 * 1024 * 1024;
const CODE = /^[A-Z0-9-]{1,30}$/;

/** Destinations are operator-owned and never accepted from callers or returned to browsers. */
export function liveDestination(provider: LiveProvider, environment: NodeJS.ProcessEnv = process.env): string | null {
    const value = environment[provider === 'youtube' ? 'LIVE_YOUTUBE_RTMPS_URL' : 'LIVE_FACEBOOK_RTMPS_URL'];
    if (!value || value.length > 2048) return null;
    try {
        const url = new URL(value);
        const hosts = provider === 'youtube' ? ['a.rtmps.youtube.com', 'b.rtmps.youtube.com'] : ['live-api-s.facebook.com', 'rtmp-api.facebook.com'];
        const prefix = provider === 'youtube' ? '/live2/' : '/rtmp/';
        if (url.protocol !== 'rtmps:' || !hosts.includes(url.hostname) || (url.port && url.port !== '443') || url.username || url.password || url.hash
            || !url.pathname.startsWith(prefix) || url.pathname.length <= prefix.length || /[\s\r\n]/.test(value)) return null;
        return value;
    } catch { return null; }
}
export function encoderArguments(destination: string): string[] {
    return ['-hide_banner', '-loglevel', 'error', '-fflags', '+genpts', '-protocol_whitelist', 'pipe', '-f', 'webm', '-i', 'pipe:0',
        '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-r', '25', '-g', '50',
        '-b:v', '2500k', '-maxrate', '2500k', '-bufsize', '5000k', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
        '-f', 'flv', '-flvflags', 'no_duration_filesize', '-progress', 'pipe:1', '-tls_verify', '1', destination];
}

export function createLiveStreaming(dependencies: Dependencies) {
    const environment = dependencies.environment || process.env;
    const executable = environment.FFMPEG_PATH || 'ffmpeg';
    const available = dependencies.encoderAvailable || (() => {
        const result = spawnSync(executable, ['-version'], { timeout: 1500, maxBuffer: 16384, stdio: 'ignore' });
        return !result.error && result.status === 0;
    });
    const startEncoder = dependencies.startEncoder || ((destination: string) => spawn(executable, encoderArguments(destination), {
        shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: environment.PATH, LANG: 'C', ...(environment.SSL_CERT_FILE ? { SSL_CERT_FILE: environment.SSL_CERT_FILE } : {}) },
    }));
    const router = express.Router();
    const tickets = new Map<string, Ticket>();
    const sessions = new Map<string, () => void>();
    const wss = new WebSocketServer({ noServer: true, maxPayload: CHUNK_LIMIT, perMessageDeflate: false });
    const origins = (environment.CORS_ORIGINS || 'http://localhost:5173').split(',').map(value => value.trim());
    const key = (ticket: Ticket) => `${ticket.user.tenantId}:${ticket.code}`;
    const prune = () => { for (const [token, ticket] of tickets) if (ticket.expires <= Date.now()) tickets.delete(token); };
    async function verify(code: string, authorization: string | undefined): Promise<Identity | null> {
        if (!CODE.test(code) || !authorization?.startsWith('Bearer ')) return null;
        const user = await dependencies.authenticate(authorization);
        if (!user?.sub || !user.tenantId || await dependencies.authorizeFeature(authorization, 'cloud_recording') !== 'allow') return null;
        const meeting = await dependencies.meeting(code);
        if (!meeting || meeting.hostId !== user.sub || meeting.status !== 'active' || meeting.settings?.e2eeRequired
            || meeting.settings?.allowRecording === false || meeting.settings?.recording_allowed === false) return null;
        return user;
    }
    const route = (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { void handler(req, res).catch(next); };
    router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
    router.use(rateLimit({ windowMs: 60000, max: 30, standardHeaders: true, legacyHeaders: false }));
    router.use(express.json({ limit: '1kb', strict: true }));
    router.get('/:meetingCode', route(async (req, res) => {
        if (!await verify(String(req.params.meetingCode), req.headers.authorization)) return res.status(403).json({ error: 'Only the signed-in meeting host with recording access can broadcast an allowed active meeting.' });
        const providers = (['youtube', 'facebook'] as const).filter(provider => liveDestination(provider, environment));
        return res.json({ providers, encoderAvailable: providers.length > 0 && available() });
    }));
    router.post('/:meetingCode/session', route(async (req, res) => {
        const code = String(req.params.meetingCode), authorization = req.headers.authorization;
        const user = await verify(code, authorization);
        if (!user || !authorization) return res.status(403).json({ error: 'Broadcast permission is unavailable for this meeting.' });
        const provider = req.body?.provider;
        if (!['youtube', 'facebook'].includes(provider) || req.body?.consent !== true || Object.keys(req.body).some(field => !['provider', 'consent'].includes(field))) return res.status(400).json({ error: 'Choose a configured provider and confirm external broadcasting.' });
        if (!liveDestination(provider, environment) || !available()) return res.status(503).json({ error: 'The broadcast destination or encoder is not configured.' });
        prune();
        const ticket: Ticket = { code, provider, authorization, user, expires: Date.now() + 30000 };
        if (sessions.has(key(ticket)) || [...tickets.values()].some(item => key(item) === key(ticket))) return res.status(409).json({ error: 'A broadcast for this meeting is already starting or running.' });
        if (tickets.size + sessions.size >= 2) return res.status(503).json({ error: 'Broadcast encoders are busy. Try again later.' });
        const token = randomBytes(32).toString('base64url'); tickets.set(token, ticket);
        return res.status(201).json({ ticket: token, socketPath: '/api/live-streams/socket', expiresIn: 30 });
    }));
    router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => { void error; res.status(503).json({ error: 'Broadcast service unavailable.' }); });

    wss.on('connection', ws => {
        let ticket: Ticket | undefined, encoder: ChildProcessWithoutNullStreams | undefined, stopped = false, firstChunk = true, lastInput = Date.now();
        let windowStart = Date.now(), received = 0, sentProgress = false, validating = false, authenticated = false;
        let health: ReturnType<typeof setInterval> | undefined, duration: ReturnType<typeof setTimeout> | undefined;
        const send = (status: string) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ status })); };
        const handshake = setTimeout(() => stop('Authentication timed out.'), 5000);
        const stop = (reason = 'stopped') => {
            if (stopped) return; stopped = true;
            clearTimeout(handshake); if (health) clearInterval(health); if (duration) clearTimeout(duration);
            if (ticket) sessions.delete(key(ticket));
            encoder?.stdin.destroy(); encoder?.kill('SIGTERM');
            const child = encoder;
            if (child) { const kill = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 2000); kill.unref(); }
            if (ws.readyState === WebSocket.OPEN) { send(reason === 'stopped' ? 'stopped' : 'error'); ws.close(reason === 'stopped' ? 1000 : 1011, reason); }
        };
        ws.on('close', () => stop()); ws.on('error', () => stop('Broadcast connection failed.'));
        ws.on('message', async (data: RawData, binary: boolean) => {
            try {
                if (!authenticated) {
                    if (validating || binary || (Array.isArray(data) ? data.reduce((sum, part) => sum + part.length, 0) : data.byteLength) > 1024) { stop('Invalid broadcast authentication.'); return; }
                    validating = true;
                    const message = JSON.parse(data.toString());
                    prune(); ticket = typeof message.ticket === 'string' ? tickets.get(message.ticket) : undefined;
                    if (ticket) tickets.delete(message.ticket);
                    if (!ticket || ticket.expires <= Date.now()) { stop('Broadcast session expired.'); return; }
                    const user = await verify(ticket.code, ticket.authorization);
                    if (stopped) return;
                    if (!user || user.sub !== ticket.user.sub || user.tenantId !== ticket.user.tenantId || sessions.has(key(ticket)) || sessions.size >= 2) { stop('Broadcast permission changed.'); return; }
                    const destination = liveDestination(ticket.provider, environment);
                    if (!destination) { stop('Broadcast destination unavailable.'); return; }
                    sessions.set(key(ticket), () => stop());
                    encoder = startEncoder(destination); authenticated = true; validating = false; clearTimeout(handshake);
                    // Never log encoder errors: FFmpeg may include the destination stream key.
                    encoder.stderr.resume(); encoder.stdin.on('error', () => stop('Broadcast encoder input failed.'));
                    encoder.on('error', () => stop('Broadcast encoder could not start.'));
                    encoder.on('exit', () => stop('Broadcast encoder stopped.'));
                    encoder.stdout.on('data', value => {
                        if (!sentProgress && /out_time_(?:us|ms)=[1-9]/.test(String(value))) { sentProgress = true; send('sending'); }
                    });
                    encoder.once('spawn', () => send('ready'));
                    let lastAuthorization = Date.now();
                    health = setInterval(() => {
                        if (Date.now() - lastInput > 15000) { stop('Broadcast input timed out.'); return; }
                        if (Date.now() - lastAuthorization < 30000 || validating) return;
                        validating = true; lastAuthorization = Date.now();
                        void verify(ticket!.code, ticket!.authorization).then(current => {
                            if (!current || current.sub !== ticket!.user.sub || current.tenantId !== ticket!.user.tenantId) stop('Broadcast permission ended.');
                        }).catch(() => stop('Broadcast permission could not be checked.')).finally(() => { validating = false; });
                    }, 5000);
                    duration = setTimeout(() => stop('The four-hour broadcast limit was reached.'), 4 * 60 * 60 * 1000);
                    return;
                }
                if (!binary) { if (data.toString() === 'stop') stop(); else stop('Invalid broadcast message.'); return; }
                const chunk = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
                if (!chunk.length || chunk.length > CHUNK_LIMIT) { stop('Broadcast chunk limit exceeded.'); return; }
                if (Date.now() - windowStart >= 10000) { windowStart = Date.now(); received = 0; }
                received += chunk.length;
                if (received > 10 * 1024 * 1024 || !encoder || encoder.stdin.writableLength + chunk.length > BUFFER_LIMIT) { stop('Broadcast connection cannot keep up.'); return; }
                if (firstChunk && !chunk.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) { stop('A WebM stream is required.'); return; }
                firstChunk = false; lastInput = Date.now(); encoder.stdin.write(chunk);
            } catch { stop('Broadcast could not continue.'); }
        });
    });
    return {
        router,
        attach(server: Server) {
            server.on('upgrade', (req, socket, head) => {
                if (req.url !== '/api/live-streams/socket' || !req.headers.origin || !origins.includes(req.headers.origin)) { socket.destroy(); return; }
                // Unauthenticated sockets have a five-second deadline and no encoder allocation.
                if (wss.clients.size >= 8) { socket.destroy(); return; }
                wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
            });
        },
        close() { tickets.clear(); for (const stop of sessions.values()) stop(); wss.close(); },
    };
}
