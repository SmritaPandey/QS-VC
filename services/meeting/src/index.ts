import { assertJwtSecret } from '../../../shared/jwt-secret.cjs';
import { insertSchedule, scheduleOccurrences } from './schedule-occurrences.js';
import { meetingAuth, requireFeature, type AuthPayload } from './auth.js';
import jwt from 'jsonwebtoken';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import http from 'http';
import { Pool } from 'pg';
import { databaseConfig } from '../../../shared/database.cjs';
import { tenantDatabase } from '../../../shared/tenant-database.cjs';
import { meetingRange } from './meeting-range.js';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import pino from 'pino';
import { attachSignalingIfAvailable } from './signaling-bridge.js';
import { disableDemoPersistence } from './demo-storage-policy.js';
import { normalizeMeetingSettings } from './meeting-settings.js';
import meetingInvitation from '../../../shared/meeting-invitation.cjs';
import { transcriptAsSrt, transcriptAsText, transcriptBody } from './transcripts.js';

const { createMeetingInviteToken } = meetingInvitation;

dotenv.config({ path: '../../.env' });
assertJwtSecret();

const logger = pino({
    transport: process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    level: process.env.LOG_LEVEL || 'info',
    name: 'qsvc-meeting',
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// VALIDATION SCHEMAS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const createMeetingBody = z.object({
    title: z.string().trim().min(1).max(255).optional(),
    type: z.enum(['instant', 'scheduled', 'recurring']).default('instant'),
    scheduledStart: z.string().datetime().optional(),
    scheduledEnd: z.string().datetime().optional(),
    recurrence: z.object({ frequency: z.enum(['daily', 'weekly']), count: z.number().int().min(2).max(12) }).optional(),
    settings: z.object({
        maxParticipants: z.number().int().min(2).max(500).default(100),
        waitingRoom: z.boolean().default(true),
        webinar: z.boolean().default(false),
        meetingKind: z.enum(['conference', 'team', 'town_hall']).optional(),
        e2eeRequired: z.boolean().default(false),
        recordingAllowed: z.boolean().default(true),
        chatEnabled: z.boolean().default(true),
        screenShareEnabled: z.boolean().default(true),
    }).optional(),
});

const updateMeetingStatusBody = z.object({
    status: z.enum(['waiting', 'active', 'ended']),
});

const joinParticipantBody = z.object({
    userId: z.string().uuid().optional(),
    displayName: z.string().min(1).max(100)
        .transform((s) => s.trim().replace(/<[^>]*>/g, '')),
    role: z.enum(['host', 'co-host', 'participant']).default('participant'),
    deviceType: z.enum(['desktop', 'mobile', 'room-system']).optional(),
    userAgent: z.string().max(500).optional(),
});

const chatMessageBody = z.object({
    senderId: z.string().uuid().optional(),
    senderName: z.string().min(1).max(100)
        .transform((s) => s.trim().replace(/<[^>]*>/g, '')),
    content: z.string().min(1, 'Message cannot be empty').max(4096)
        .transform((s) => s.trim().replace(/<script[^>]*>.*?<\/script>/gi, '')),
    type: z.enum(['text', 'file', 'system']).default('text'),
});

function validateBody<T>(schema: z.ZodSchema<T>) {
    return (req: Request, res: Response, next: NextFunction) => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: result.error.issues.map((i) => ({
                    field: i.path.join('.'),
                    message: i.message,
                })),
            });
        }
        req.body = result.data;
        next();
    };
}

const app = express();
app.disable('x-powered-by'); // Do not advertise the framework (OWASP A05).

// CORS: merge env with production defaults so stale Render env can't lock out Vercel
const DEFAULT_CORS_ORIGINS = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://qs-vc.vercel.app',
    'https://dist-puce-one-68.vercel.app',
];
const corsOriginsEnv = process.env.CORS_ORIGINS;
const allowedOrigins = corsOriginsEnv === '*'
    ? true
    : [...new Set([
        ...(corsOriginsEnv ? corsOriginsEnv.split(',').map((o) => o.trim()).filter(Boolean) : []),
        ...DEFAULT_CORS_ORIGINS,
    ])];
app.use(cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    credentials: true,
}));
app.use(express.json());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, skip: req => { if (!req.path.startsWith('/api/internal/meetings/')) return false; try { jwt.verify((req.headers.authorization || '').replace(/^Bearer /, ''), process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production', { audience: 'qsvc-meeting-policy', issuer: 'qsvc-internal' }); return true; } catch { return false; } }, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } }));

const PORT = parseInt(process.env.PORT || process.env.MEETING_PORT || '4003', 10);
const AUTH_URL = process.env.AUTH_INTERNAL_URL || 'http://localhost:4002';

const rawPool = new Pool(databaseConfig({ ...process.env, DATABASE_URL: process.env.MEETING_DATABASE_URL || process.env.DATABASE_URL }));
const pool = tenantDatabase(rawPool);
// Idle connections can fail during database restarts without a pending request.
rawPool.on('error', () => logger.warn('Database connection lost; the pool will reconnect on demand'));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AUTH MIDDLEWARE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const authMiddleware = meetingAuth(AUTH_URL, (tenantId, next) => pool.runWithTenant(tenantId, next));
const scheduleFeature = requireFeature(AUTH_URL, 'meeting_scheduling');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MEETING CODE GENERATOR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function generateMeetingCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const segments = [];
    for (let s = 0; s < 3; s++) {
        let seg = '';
        for (let i = 0; i < 4; i++) {
            seg += chars[Math.floor(Math.random() * chars.length)];
        }
        segments.push(seg);
    }
    return `QS-${segments.join('-')}`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ROUTES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'qsvc-meeting' });
});

app.get('/ready', async (_req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ready' });
    } catch {
        res.status(503).json({ status: 'unavailable', dependency: 'database' });
    }
});

// Quick meeting creation (no auth required — for demo/guest access)
app.post('/api/meetings/create', async (_req, res) => {
    try {
        const meetingCode = generateMeetingCode();
        const inviteToken = createMeetingInviteToken(meetingCode);
        const WEB_URL = (process.env.WEB_URL || 'https://qs-vc.vercel.app').replace(/\/$/, '');

        // Try to persist to DB, fall back to in-memory if DB isn't ready
        try {
            const id = uuidv4();
            await pool.runWithTenant('00000000-0000-0000-0000-000000000001', () => pool.query(
                `INSERT INTO meetings (id, tenant_id, meeting_code, title, host_id, type, status, settings)
                 VALUES ($1, '00000000-0000-0000-0000-000000000001', $2, 'Quick Meeting', NULL, 'instant', 'waiting', '{}')`,
                [id, meetingCode]
            ));
        } catch (dbErr: any) {
            logger.warn('DB insert skipped (demo mode): ' + dbErr.message);
        }

        res.json({
            meetingCode,
            inviteToken,
            joinUrl: `${WEB_URL}/meeting/${meetingCode}/preview?invite=${encodeURIComponent(inviteToken)}`,
        });
    } catch (err: any) {
        logger.error(err, 'Failed to create quick meeting');
        res.status(500).json({ error: 'Failed to create meeting' });
    }
});

// Create instant meeting
app.post('/api/meetings', authMiddleware, validateBody(createMeetingBody), async (req, res) => {
    try {
        const user = (req as any).user as AuthPayload;
        const { title, settings } = req.body;
        const meetingCode = generateMeetingCode();
        const inviteToken = createMeetingInviteToken(meetingCode);
        const id = uuidv4();

        await pool.query(
            `INSERT INTO meetings (id, tenant_id, meeting_code, title, host_id, type, status, settings)
       VALUES ($1, $2, $3, $4, $5, 'instant', 'waiting', $6)`,
            [id, user.tenantId, meetingCode, title || 'Instant Meeting', user.sub, JSON.stringify(normalizeMeetingSettings(settings))]
        );

        logger.info(`Meeting created: ${meetingCode} by ${user.displayName}`);
        res.status(201).json({
            id,
            meetingCode,
            title: title || 'Instant Meeting',
            inviteToken,
            joinUrl: `${process.env.WEB_URL || 'https://qs-vc.vercel.app'}/meeting/${meetingCode}/preview?invite=${encodeURIComponent(inviteToken)}`,
            hostId: user.sub,
        });
    } catch (err: any) {
        logger.error(err, 'Failed to create meeting');
        res.status(500).json({ error: 'Failed to create meeting' });
    }
});

// Schedule meeting
app.post('/api/meetings/schedule', scheduleFeature, authMiddleware, validateBody(createMeetingBody), async (req, res) => {
    try {
        const user = (req as any).user as AuthPayload;
        const { title, scheduledStart, scheduledEnd, settings, recurrence }: z.infer<typeof createMeetingBody> = req.body;
        const times = scheduledStart && scheduleOccurrences(scheduledStart, scheduledEnd, recurrence);
        if (!times) return res.status(400).json({ error: 'Provide a meeting start and an end after the start.' });

        const seriesId = recurrence ? uuidv4() : undefined;
        const occurrences = times.map(time => ({ ...time, id: uuidv4(), meetingCode: generateMeetingCode() }));
        const occurrencesWithInvites = occurrences.map(occurrence => ({ ...occurrence, inviteToken: createMeetingInviteToken(occurrence.meetingCode) }));
        await insertSchedule(pool, user.tenantId, title || 'Scheduled Meeting', user.sub,
            recurrence ? 'recurring' : 'scheduled', { ...normalizeMeetingSettings(settings), seriesId }, occurrences);

        const first = occurrences[0];
        const inviteToken = createMeetingInviteToken(first.meetingCode);
        res.status(201).json({
            ...first,
            title: title || 'Scheduled Meeting',
            inviteToken,
            joinUrl: `${process.env.WEB_URL || 'https://qs-vc.vercel.app'}/meeting/${first.meetingCode}/preview?invite=${encodeURIComponent(inviteToken)}`,
            seriesId,
            occurrences: occurrencesWithInvites,
        });
    } catch (err: any) {
        logger.error(err, 'Failed to schedule meeting');
        res.status(500).json({ error: 'Failed to schedule meeting' });
    }
});

// Get meeting by code
app.get('/api/internal/meetings/:code', async (req, res) => {
    try {
        jwt.verify((req.headers.authorization || '').replace(/^Bearer /, ''), process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production', { audience: 'qsvc-meeting-policy', issuer: 'qsvc-internal' });
    } catch { return res.status(401).json({ error: 'Invalid service authentication' }); }
    try {
        const result = await pool.query('SELECT * FROM public.qsvc_meeting_by_code($1)', [String(req.params.code).toUpperCase()]);
        if (!result.rows.length) return res.status(404).json({ error: 'Meeting not found' });
        const row = result.rows[0];
        res.setHeader('Cache-Control', 'no-store');
        res.json({ hostId: row.host_id, status: row.status, settings: row.settings || {} });
    } catch { res.status(503).json({ error: 'Meeting storage unavailable' }); }
});

// In-meeting "Report a problem". Guests can report too, so no sign-in is required;
// the global rate limit applies and diagnostics are size-capped.
const problemReportBody = z.object({
    category: z.enum(['audio', 'video', 'screen', 'connection', 'captions', 'other']),
    description: z.string().trim().min(1).max(2000),
    meetingCode: z.string().trim().max(30).regex(/^[A-Za-z0-9-]*$/).optional(),
    reporterName: z.string().trim().max(100).optional(),
    diagnostics: z.record(z.string(), z.unknown()).optional(),
});
app.post('/api/meetings/problem-reports', express.json({ limit: '24kb' }), async (req, res) => {
    const parsed = problemReportBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Describe the problem in up to 2000 characters.' });
    const { category, description, meetingCode, reporterName, diagnostics } = parsed.data;
    const diag = JSON.stringify(diagnostics || {});
    if (diag.length > 16000) return res.status(413).json({ error: 'Technical details are too large.' });
    const id = uuidv4();
    logger.warn({ event: 'problem_report', id, category, meetingCode }, 'Problem reported from a meeting');
    try {
        await pool.query(
            `INSERT INTO problem_reports (id, meeting_code, category, description, reporter_name, diagnostics) VALUES ($1, $2, $3, $4, $5, $6)`,
            [id, meetingCode ? meetingCode.toUpperCase() : null, category, description, reporterName || null, diag],
        );
        res.status(201).json({ id });
    } catch (err: any) {
        logger.error({ err: err.message, id }, 'Problem report not stored');
        res.status(503).json({ error: 'Your report could not be saved right now. Download it and send it to support instead.' });
    }
});

// Signaling reports that the host started or ended the meeting (service-to-service only).
app.post('/api/internal/meetings/:code/status', express.json(), async (req, res) => {
    try {
        jwt.verify((req.headers.authorization || '').replace(/^Bearer /, ''), process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production', { audience: 'qsvc-meeting-policy', issuer: 'qsvc-internal' });
    } catch { return res.status(401).json({ error: 'Invalid service authentication' }); }
    const status = req.body?.status;
    if (status !== 'active' && status !== 'ended') return res.status(400).json({ error: 'status must be active or ended' });
    try {
        const result = await pool.query('SELECT public.qsvc_set_meeting_live_status($1, $2) AS updated', [String(req.params.code).toUpperCase(), status]);
        res.json({ updated: !!result.rows[0]?.updated });
    } catch (err: any) {
        logger.warn('Live status not recorded: ' + err.message);
        res.status(503).json({ error: 'Meeting storage unavailable' });
    }
});

// Signaling stores a host-enabled transcript (service-to-service only). Idempotent per segment.
app.post('/api/internal/meetings/:code/transcript', express.json({ limit: '2mb' }), async (req, res) => {
    try {
        jwt.verify((req.headers.authorization || '').replace(/^Bearer /, ''), process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production', { audience: 'qsvc-meeting-policy', issuer: 'qsvc-internal' });
    } catch { return res.status(401).json({ error: 'Invalid service authentication' }); }
    const parsed = transcriptBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid transcript' });
    const code = String(req.params.code).toUpperCase().slice(0, 30);
    const { startedAt, segments, minutes } = parsed.data;
    try {
        await pool.query(
            `INSERT INTO meeting_transcripts (meeting_code, started_at, minutes) VALUES ($1, $2, $3)
             ON CONFLICT (meeting_code, started_at) DO UPDATE SET minutes = COALESCE(EXCLUDED.minutes, meeting_transcripts.minutes), updated_at = NOW()`,
            [code, startedAt, minutes ?? null],
        );
        if (segments.length) {
            await pool.query(
                `INSERT INTO meeting_transcript_segments (meeting_code, segment_id, started_at, speaker, language, text, spoken_at)
                 SELECT $1, s.id, $2, s.speaker, s.language, s.text, to_timestamp(s.ts / 1000.0)
                 FROM jsonb_to_recordset($3::jsonb) AS s(id text, speaker text, language text, text text, ts bigint)
                 ON CONFLICT (meeting_code, segment_id) DO NOTHING`,
                [code, startedAt, JSON.stringify(segments.map(segment => ({ id: segment.id, speaker: segment.speaker, language: segment.language, text: segment.text, ts: segment.timestamp })))],
            );
        }
        res.json({ stored: segments.length });
    } catch (err: any) {
        logger.warn('Transcript not stored: ' + err.message);
        res.status(503).json({ error: 'Transcript storage unavailable' });
    }
});

// The meeting's host downloads saved transcripts and minutes: ?format=json (default) | txt | srt
app.get('/api/meetings/code/:code/transcript', authMiddleware, async (req, res) => {
    const user = (req as any).user as AuthPayload;
    const code = String(req.params.code).toUpperCase().slice(0, 30);
    try {
        const meeting = await pool.query('SELECT host_id FROM public.qsvc_meeting_by_code($1)', [code]);
        if (!meeting.rows.length) return res.status(404).json({ error: 'Meeting not found' });
        if (meeting.rows[0].host_id !== user.sub && user.role !== 'admin') return res.status(403).json({ error: 'Only the meeting host can open its transcript' });
        const [sessions, rows] = await Promise.all([
            pool.query('SELECT started_at, minutes FROM meeting_transcripts WHERE meeting_code = $1 ORDER BY started_at', [code]),
            pool.query('SELECT segment_id, speaker, language, text, spoken_at FROM meeting_transcript_segments WHERE meeting_code = $1 ORDER BY spoken_at, segment_id LIMIT 200000', [code]),
        ]);
        const minutes = sessions.rows.map((row: any) => row.minutes).filter(Boolean).join('\n\n') || null;
        res.setHeader('Cache-Control', 'no-store');
        const format = String(req.query.format || 'json');
        if (format === 'txt') { res.type('text/plain; charset=utf-8').setHeader('Content-Disposition', `attachment; filename="${code}-transcript.txt"`); return res.send(transcriptAsText(rows.rows, minutes)); }
        if (format === 'srt') { res.type('application/x-subrip; charset=utf-8').setHeader('Content-Disposition', `attachment; filename="${code}.srt"`); return res.send(transcriptAsSrt(rows.rows)); }
        res.json({ meetingCode: code, minutes, sessions: sessions.rows.map((row: any) => ({ startedAt: row.started_at, minutes: row.minutes })), segments: rows.rows.map((row: any) => ({ id: row.segment_id, speaker: row.speaker, language: row.language, text: row.text, spokenAt: row.spoken_at })) });
    } catch (err: any) {
        logger.warn('Transcript not read: ' + err.message);
        res.status(503).json({ error: 'Transcript storage unavailable' });
    }
});

app.get('/api/meetings/code/:code', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM public.qsvc_meeting_by_code($1)`,
            [String(req.params.code).toUpperCase()]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Meeting not found' });
        }

        const m = result.rows[0];
        res.json({
            id: m.id,
            meetingCode: m.meeting_code,
            title: m.title,
            hostId: m.host_id,
            hostName: m.host_name,
            type: m.type,
            status: m.status,
            scheduledStart: m.scheduled_start,
            scheduledEnd: m.scheduled_end,
            settings: Object.fromEntries(Object.entries(m.settings || {}).filter(([key]) => key !== 'password')),
            createdAt: m.created_at,
        });
    } catch (err: any) {
        logger.error(err, 'Failed to get meeting');
        res.status(500).json({ error: 'Failed to get meeting' });
    }
});

// Summarize meetings without returning links or participant data.
async function meetingAnalytics(req: Request, res: Response, hostOnly: boolean) {
    const user = (req as any).user as AuthPayload;
    if (!hostOnly && user.role !== 'admin') return res.status(403).json({ error: 'Administrator access is required' });

    const quarters = req.query.quarters ?? '4';
    if (typeof quarters !== 'string' || !/^(?:[1-9]|1[0-2])$/.test(quarters)) {
        return res.status(400).json({ error: 'Choose 1 to 12 quarters' });
    }

    try {
        const result = await pool.query(
            `WITH periods AS (
                SELECT period
                FROM generate_series(
                    date_trunc('quarter', NOW() AT TIME ZONE 'UTC') - ($2::int - 1) * INTERVAL '3 months',
                    date_trunc('quarter', NOW() AT TIME ZONE 'UTC'),
                    INTERVAL '3 months'
                ) AS series(period)
            ), by_status AS (
                SELECT status, count(*) AS count,
                       count(*) FILTER (WHERE scheduled_start IS NOT NULL) AS scheduled
                FROM meetings WHERE tenant_id = $1 AND ($3::uuid IS NULL OR host_id = $3)
                GROUP BY status
            ), by_quarter AS (
                SELECT date_trunc('quarter', created_at AT TIME ZONE 'UTC') AS period, count(*) AS count
                FROM meetings
                WHERE tenant_id = $1 AND ($3::uuid IS NULL OR host_id = $3)
                    AND created_at >= ((SELECT min(period) FROM periods) AT TIME ZONE 'UTC')
                GROUP BY 1
            )
            SELECT
                (SELECT json_build_object(
                    'links', COALESCE(sum(count), 0),
                    'scheduled', COALESCE(sum(scheduled), 0),
                    'active', COALESCE(sum(count) FILTER (WHERE status = 'active'), 0)
                ) FROM by_status) AS totals,
                COALESCE((SELECT json_agg(json_build_object('status', status, 'count', count) ORDER BY status)
                    FROM by_status), '[]'::json) AS statuses,
                (SELECT json_agg(json_build_object('quarter', to_char(periods.period, 'YYYY "Q"Q'),
                    'count', COALESCE(by_quarter.count, 0)) ORDER BY periods.period)
                    FROM periods LEFT JOIN by_quarter USING (period)) AS quarters`,
            [user.tenantId, Number(quarters), hostOnly ? user.sub : null],
        );
        res.set('Cache-Control', 'no-store').json(result.rows[0]);
    } catch (error) {
        logger.error(error, 'Failed to load meeting analytics');
        res.status(503).json({ error: 'Meeting analytics are temporarily unavailable' });
    }
}

app.get('/api/meetings/admin/analytics', authMiddleware, (req, res) => meetingAnalytics(req, res, false));
app.get('/api/meetings/me/analytics', authMiddleware, (req, res) => meetingAnalytics(req, res, true));

// List user's meetings
app.get('/api/meetings', authMiddleware, async (req, res) => {
    try {
        const user = (req as any).user as AuthPayload;
        const { status, type, limit, offset } = req.query;
        let range;
        try { range = meetingRange(req.query.start, req.query.end); }
        catch { return res.status(400).json({ error: 'Provide a valid start/end date range of up to 31 days.' }); }

        let query = `SELECT * FROM meetings WHERE tenant_id = $1`;
        const params: any[] = [user.tenantId];
        let idx = 2;
        // ?host=me lists only meetings the signed-in user created (their "Meetings I host" view).
        if (req.query.host === 'me') { query += ` AND host_id = $${idx++}`; params.push(user.sub); }

        if (range) {
            query += ` AND COALESCE(scheduled_start, created_at) >= $${idx++} AND COALESCE(scheduled_start, created_at) < $${idx++}`;
            params.push(range.start, range.end);
        }
        if (status) { query += ` AND status = $${idx++}`; params.push(status); }
        if (type) { query += ` AND type = $${idx++}`; params.push(type); }

        query += range
            ? ` ORDER BY COALESCE(scheduled_start, created_at) ASC, id ASC LIMIT $${idx++} OFFSET $${idx++}`
            : ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
        params.push(parseInt(limit as string) || 50, parseInt(offset as string) || 0);

        const result = await pool.query(query, params);

        res.json({
            meetings: result.rows.map((m) => ({
                id: m.id,
                meetingCode: m.meeting_code,
                title: m.title,
                type: m.type,
                status: m.status,
                scheduledStart: m.scheduled_start,
                scheduledEnd: m.scheduled_end,
                actualStart: m.actual_start,
                actualEnd: m.actual_end,
                createdAt: m.created_at,
                hostId: m.host_id,
                isHost: m.host_id === user.sub,
                canCancel: m.host_id === user.sub || user.role === 'admin',
                ...(m.host_id === user.sub ? { inviteToken: createMeetingInviteToken(m.meeting_code) } : {}),
            })),
            total: result.rowCount,
        });
    } catch (err: any) {
        logger.error(err, 'Failed to list meetings');
        res.status(500).json({ error: 'Failed to list meetings' });
    }
});

// Update one scheduled occurrence. Serialize changes with the meeting status.
const editScheduleBody = z.discriminatedUnion('action', [
    z.object({ action: z.literal('cancel') }),
    z.object({ action: z.literal('reschedule'), start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }) }),
]);

app.patch('/api/meetings/:id/schedule', scheduleFeature, authMiddleware, validateBody(editScheduleBody), async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid meeting ID' });
    const edit = req.body as z.infer<typeof editScheduleBody>;
    const user = (req as any).user as AuthPayload;
    const rescheduling = edit.action === 'reschedule';
    if (rescheduling && (Date.parse(edit.start) <= Date.now() || Date.parse(edit.end) <= Date.parse(edit.start))) {
        return res.status(400).json({ error: 'Choose a future start and a later end' });
    }
    try {
        const result = await pool.query(
            `UPDATE meetings SET status = $1, updated_at = NOW(),
                scheduled_start = COALESCE($2::timestamptz, scheduled_start),
                scheduled_end = COALESCE($3::timestamptz, scheduled_end)
             WHERE id = $4 AND tenant_id = $5 AND (host_id = $6 OR $7)
                 AND scheduled_start IS NOT NULL AND (status = 'waiting' OR ($1 = 'cancelled' AND status = 'cancelled'))
             RETURNING id, status, scheduled_start AS "scheduledStart", scheduled_end AS "scheduledEnd"`,
            [rescheduling ? 'waiting' : 'cancelled', rescheduling ? edit.start : null,
                rescheduling ? edit.end : null, id.data, user.tenantId, user.sub, user.role === 'admin'],
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Editable scheduled meeting not found' });
        res.json(result.rows[0]);
    } catch (error) {
        logger.error(error, 'Failed to edit scheduled meeting');
        res.status(500).json({ error: 'Failed to edit scheduled meeting' });
    }
});

// Update meeting status (start/end)
app.patch('/api/meetings/:id/status', authMiddleware, validateBody(updateMeetingStatusBody), async (req, res) => {
    try {
        const { status } = req.body;
        const user = (req as any).user as AuthPayload;
        const timestamp = status === 'active' ? ', actual_start = NOW()' : status === 'ended' ? ', actual_end = NOW()' : '';
        const result = await pool.query(
            `UPDATE meetings SET status = $1, updated_at = NOW()${timestamp}
             WHERE id = $2 AND tenant_id = $3 AND (host_id = $4 OR $5) AND status <> 'cancelled' RETURNING id`,
            // Platform admins can start or end any meeting in their tenant.
            [status, req.params.id, user.tenantId, user.sub, user.role === 'admin']
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Meeting not found or not owned by you' });

        res.json({ updated: true, status });
    } catch (err: any) {
        logger.error(err, 'Failed to update meeting status');
        res.status(500).json({ error: 'Failed to update meeting status' });
    }
});

// These legacy endpoints have no membership checks; keep them closed in the demo.
app.use('/api/meetings/:meetingId/participants', disableDemoPersistence);
app.use('/api/meetings/:meetingId/chat', disableDemoPersistence);

// Record participant join
app.post('/api/meetings/:meetingId/participants', validateBody(joinParticipantBody), async (req, res) => {
    try {
        const { userId, displayName, deviceType, ipAddress, userAgent } = req.body;
        const id = uuidv4();

        await pool.query(
            `INSERT INTO meeting_participants (id, meeting_id, user_id, display_name, device_type, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (meeting_id, user_id) DO UPDATE SET join_time = NOW(), leave_time = NULL`,
            [id, req.params.meetingId, userId || null, displayName, deviceType || 'desktop', ipAddress || null, userAgent || null]
        );

        res.status(201).json({ participantId: id });
    } catch (err: any) {
        logger.error(err, 'Failed to record participant');
        res.status(500).json({ error: 'Failed to record participant' });
    }
});

// Record participant leave
app.patch('/api/meetings/:meetingId/participants/:userId/leave', async (req, res) => {
    try {
        await pool.query(
            `UPDATE meeting_participants
       SET leave_time = NOW(), duration_sec = EXTRACT(EPOCH FROM (NOW() - join_time))::INT
       WHERE meeting_id = $1 AND user_id = $2 AND leave_time IS NULL`,
            [req.params.meetingId, req.params.userId]
        );

        res.json({ left: true });
    } catch (err: any) {
        logger.error(err, 'Failed to record participant leave');
        res.status(500).json({ error: 'Failed to record participant leave' });
    }
});

// Save chat message
app.post('/api/meetings/:meetingId/chat', validateBody(chatMessageBody), async (req, res) => {
    try {
        const { senderId, senderName, content, type, metadata } = req.body;
        const id = uuidv4();

        await pool.query(
            `INSERT INTO chat_messages (id, meeting_id, sender_id, sender_name, content, type, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, req.params.meetingId, senderId || null, senderName, content, type || 'text', metadata ? JSON.stringify(metadata) : null]
        );

        res.status(201).json({ messageId: id });
    } catch (err: any) {
        logger.error(err, 'Failed to save chat message');
        res.status(500).json({ error: 'Failed to save chat message' });
    }
});

// Get chat history
app.get('/api/meetings/:meetingId/chat', async (req, res) => {
    try {
        const { limit, before } = req.query;
        let query = `SELECT * FROM chat_messages WHERE meeting_id = $1`;
        const params: any[] = [req.params.meetingId];
        let idx = 2;

        if (before) { query += ` AND created_at < $${idx++}`; params.push(before); }
        query += ` ORDER BY created_at ASC LIMIT $${idx++}`;
        params.push(parseInt(limit as string) || 100);

        const result = await pool.query(query, params);

        res.json({
            messages: result.rows.map((m) => ({
                id: m.id,
                senderId: m.sender_id,
                senderName: m.sender_name,
                content: m.content,
                type: m.type,
                timestamp: m.created_at,
            })),
        });
    } catch (err: any) {
        logger.error(err, 'Failed to get chat history');
        res.status(500).json({ error: 'Failed to get chat history' });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GLOBAL ERROR HANDLER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error(err, 'Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// START
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const HOST = process.env.HOST || '0.0.0.0';
const server = http.createServer(app);

attachSignalingIfAvailable(server).then((attached) => {
    server.listen(PORT, HOST, () => {
        logger.info(`📋 QS-VC Meeting Service running on ${HOST}:${PORT}${attached ? ' (+ signaling /ws)' : ''}`);
    });
}).catch((err) => {
    logger.error(err, 'Failed to attach signaling WebSocket');
    process.exit(1);
});

process.on('SIGTERM', () => { rawPool.end(); process.exit(0); });
process.on('SIGINT', () => { rawPool.end(); process.exit(0); });
