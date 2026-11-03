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

dotenv.config({ path: '../../.env' });

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
    title: z.string().max(255).optional(),
    type: z.enum(['instant', 'scheduled', 'recurring']).default('instant'),
    scheduledStart: z.string().datetime().optional(),
    scheduledEnd: z.string().datetime().optional(),
    settings: z.object({
        maxParticipants: z.number().int().min(2).max(500).default(100),
        waitingRoom: z.boolean().default(false),
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

interface AuthPayload { sub: string; tenantId: string; role: string; displayName: string; }

async function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }
    try {
        const response = await fetch(`${AUTH_URL}/api/auth/verify`, {
            headers: { Authorization: authHeader, 'x-qsvc-service-token': jwt.sign({}, process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production', { audience: 'qsvc-auth-verify', issuer: 'qsvc-internal', expiresIn: 30 }) }, signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error('Invalid session');
        const verified = await response.json() as { valid: boolean; payload: AuthPayload };
        if (!verified.valid || !verified.payload?.sub) throw new Error('Invalid session');
        const payload = verified.payload;
        (req as any).user = payload;
        pool.runWithTenant(payload.tenantId, next);
    } catch {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

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
            joinUrl: `${WEB_URL}/meeting/${meetingCode}/preview`,
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
        const id = uuidv4();

        await pool.query(
            `INSERT INTO meetings (id, tenant_id, meeting_code, title, host_id, type, status, settings)
       VALUES ($1, $2, $3, $4, $5, 'instant', 'waiting', $6)`,
            [id, user.tenantId, meetingCode, title || 'Instant Meeting', user.sub, JSON.stringify(settings || {})]
        );

        logger.info(`Meeting created: ${meetingCode} by ${user.displayName}`);
        res.status(201).json({
            id,
            meetingCode,
            title: title || 'Instant Meeting',
            joinUrl: `${process.env.WEB_URL || 'https://qs-vc.vercel.app'}/meeting/${meetingCode}`,
            hostId: user.sub,
        });
    } catch (err: any) {
        logger.error(err, 'Failed to create meeting');
        res.status(500).json({ error: 'Failed to create meeting' });
    }
});

// Schedule meeting
app.post('/api/meetings/schedule', authMiddleware, validateBody(createMeetingBody), async (req, res) => {
    try {
        const user = (req as any).user as AuthPayload;
        const { title, scheduledStart, scheduledEnd, settings } = req.body;

        const meetingCode = generateMeetingCode();
        const id = uuidv4();

        await pool.query(
            `INSERT INTO meetings (id, tenant_id, meeting_code, title, host_id, type, status, scheduled_start, scheduled_end, settings)
       VALUES ($1, $2, $3, $4, $5, 'scheduled', 'waiting', $6, $7, $8)`,
            [id, user.tenantId, meetingCode, title || 'Scheduled Meeting', user.sub,
                scheduledStart, scheduledEnd || null, JSON.stringify(settings || {})]
        );

        logger.info(`Scheduled meeting: ${meetingCode} at ${scheduledStart}`);
        res.status(201).json({
            id,
            meetingCode,
            title: title || 'Scheduled Meeting',
            scheduledStart,
            scheduledEnd,
            joinUrl: `${process.env.WEB_URL || 'https://qs-vc.vercel.app'}/meeting/${meetingCode}`,
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
                createdAt: m.created_at,
            })),
            total: result.rowCount,
        });
    } catch (err: any) {
        logger.error(err, 'Failed to list meetings');
        res.status(500).json({ error: 'Failed to list meetings' });
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
             WHERE id = $2 AND tenant_id = $3 AND host_id = $4 RETURNING id`,
            [status, req.params.id, user.tenantId, user.sub]
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
    server.listen(PORT, HOST, () => {
        logger.info(`📋 QS-VC Meeting Service running on ${HOST}:${PORT} (meeting-only)`);
    });
});

process.on('SIGTERM', () => { rawPool.end(); process.exit(0); });
process.on('SIGINT', () => { rawPool.end(); process.exit(0); });
