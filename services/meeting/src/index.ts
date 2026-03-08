import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import pino from 'pino';

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

// CORS: restrict origins per environment
const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
    : ['http://localhost:5173'];
app.use(cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    credentials: true,
}));
app.use(express.json());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } }));

const PORT = parseInt(process.env.PORT || process.env.MEETING_PORT || '4003', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production';

// Database pool — supports DATABASE_URL (Render) or individual env vars (local)
const pool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
    : new Pool({
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
        database: process.env.POSTGRES_DB || 'qsvc',
        user: process.env.POSTGRES_USER || 'qsvc',
        password: process.env.POSTGRES_PASSWORD || 'qsvc_dev_2025',
    });

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AUTH MIDDLEWARE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface AuthPayload { sub: string; tenantId: string; role: string; displayName: string; }

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }
    try {
        const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as AuthPayload;
        (req as any).user = payload;
        next();
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
            joinUrl: `${process.env.WEB_URL || 'http://localhost:5173'}/meeting/${meetingCode}`,
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
            joinUrl: `${process.env.WEB_URL || 'http://localhost:5173'}/meeting/${meetingCode}`,
        });
    } catch (err: any) {
        logger.error(err, 'Failed to schedule meeting');
        res.status(500).json({ error: 'Failed to schedule meeting' });
    }
});

// Get meeting by code
app.get('/api/meetings/code/:code', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT m.*, u.display_name as host_name
       FROM meetings m LEFT JOIN users u ON m.host_id = u.id
       WHERE m.meeting_code = $1`,
            [req.params.code.toUpperCase()]
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
            settings: m.settings,
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

        let query = `SELECT * FROM meetings WHERE tenant_id = $1`;
        const params: any[] = [user.tenantId];
        let idx = 2;

        if (status) { query += ` AND status = $${idx++}`; params.push(status); }
        if (type) { query += ` AND type = $${idx++}`; params.push(type); }

        query += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
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

        if (status === 'active') {
            await pool.query(
                'UPDATE meetings SET status = $1, actual_start = NOW(), updated_at = NOW() WHERE id = $2',
                [status, req.params.id]
            );
        } else if (status === 'ended') {
            await pool.query(
                'UPDATE meetings SET status = $1, actual_end = NOW(), updated_at = NOW() WHERE id = $2',
                [status, req.params.id]
            );
        } else {
            await pool.query(
                'UPDATE meetings SET status = $1, updated_at = NOW() WHERE id = $2',
                [status, req.params.id]
            );
        }

        res.json({ updated: true, status });
    } catch (err: any) {
        logger.error(err, 'Failed to update meeting status');
        res.status(500).json({ error: 'Failed to update meeting status' });
    }
});

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

app.listen(PORT, () => {
    logger.info(`📋 QS-VC Meeting Service running on port ${PORT}`);
});

process.on('SIGTERM', () => { pool.end(); process.exit(0); });
process.on('SIGINT', () => { pool.end(); process.exit(0); });
