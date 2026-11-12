import { roomDialHandler } from './room-dial.js';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import http from 'http';
import { config } from './config.js';
import { logger } from './logger.js';
import { roomManager } from './room-manager.js';
import { attachSignalingWebSocket, InvalidAuthentication, verifySession } from './ws-attach.js';
import { createWebSocketTicket } from './ws-tickets.js';

const AUTH_INTERNAL_URL = (process.env.AUTH_INTERNAL_URL || 'http://localhost:4002').replace(/\/$/, '');
const MEETING_INTERNAL_URL = (process.env.MEETING_INTERNAL_URL || 'http://localhost:4003').replace(/\/$/, '');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);  // Trust first proxy (Cloudflare tunnel)

// CORS: merge env with production defaults so stale Render env can't lock out Vercel
const DEFAULT_CORS_ORIGINS = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5174',
    'https://qs-vc.vercel.app',
    'https://dist-puce-one-68.vercel.app',
];
const corsOriginsEnv = process.env.CORS_ORIGINS;
const allowedOrigins = corsOriginsEnv === '*'
    ? true  // Allow all origins (tunnel/dev mode)
    : [...new Set([
        ...(corsOriginsEnv ? corsOriginsEnv.split(',').map((o) => o.trim()).filter(Boolean) : []),
        ...DEFAULT_CORS_ORIGINS,
    ])];
app.use(cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
}));
app.use(express.json());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } }));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REST API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.post('/api/internal/room-numbers/:number/resolve', roomDialHandler);

app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        service: 'qsvc-signaling',
        rooms: roomManager.getRoomCount(),
    });
});

// Keep the legacy fallback URL, but route creation through the meeting service so every
// returned code is persisted and protected by PostgreSQL's unique meeting_code constraint.
app.post('/api/meetings/create', async (_req, res) => {
    try {
        const response = await fetch(`${MEETING_INTERNAL_URL}/api/meetings/create`, { method: 'POST', signal: AbortSignal.timeout(5000) });
        const body = await response.json().catch(() => ({ error: 'Meeting service returned an invalid response.' }));
        res.setHeader('Cache-Control', 'no-store');
        return res.status(response.status).json(body);
    } catch (error) {
        logger.warn({ error }, 'Could not create meeting through meeting service');
        return res.status(503).json({ error: 'Meeting creation is temporarily unavailable.' });
    }
});

// Return STUN and short-lived TURN credentials from Auth. TURN's shared secret
// stays server-side and is never included in the client response.
app.get('/api/ice-servers', async (req, res) => {
    const authorization = req.headers.authorization;
    res.setHeader('Cache-Control', 'no-store');
    if (!authorization?.startsWith('Bearer ')) return res.status(401).json({ error: 'Join a meeting or sign in to use the relay.' });
    try {
        const response = await fetch(`${AUTH_INTERNAL_URL}/api/auth/turn-credentials`, { headers: { Authorization: authorization }, signal: AbortSignal.timeout(3000) });
        if (response.status === 401 || response.status === 403) return res.status(401).json({ error: 'Invalid relay access.' });
        if (!response.ok) throw new Error(`Auth returned ${response.status}`);
        const body = await response.json() as { iceServers?: { urls: string | string[]; username?: string; credential?: string }[]; ttl?: number };
        if (!Array.isArray(body.iceServers) || !body.iceServers.length) throw new Error('Auth returned no ICE servers');
        res.setHeader('Cache-Control', 'no-store');
        return res.json({ iceServers: body.iceServers, ttl: body.ttl });
    } catch (error) {
        logger.warn({ error }, 'ICE server credentials are temporarily unavailable');
        return res.status(503).json({ error: 'ICE server configuration is temporarily unavailable.' });
    }
});

// Exchange a verified login session for a 30-second, single-use WebSocket ticket. The
// long-lived bearer never appears in the WebSocket URL or upgrade logs.
app.post('/api/signaling-ticket', rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false }), async (req, res) => {
    const authorization = req.headers.authorization || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const meetingCode = typeof req.body?.meetingCode === 'string' ? req.body.meetingCode.trim().toUpperCase() : '';
    if (!token) return res.status(401).json({ error: 'Sign in to create a signaling ticket.' });
    if (!/^[A-Z0-9-]{4,32}$/.test(meetingCode)) return res.status(400).json({ error: 'A valid meeting code is required.' });
    try {
        const user = await verifySession(token);
        const ticket = await createWebSocketTicket({ token, userId: user.sub, meetingCode });
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Pragma', 'no-cache');
        return res.json({ ticket, expiresIn: 30 });
    } catch (error) {
        if (error instanceof InvalidAuthentication) return res.status(401).json({ error: 'Your session expired. Sign in again.' });
        logger.error({ error }, 'Could not issue signaling ticket');
        return res.status(503).json({ error: 'Signaling authentication is temporarily unavailable.' });
    }
});

// Preserve the previous meeting-service URL for clients, without creating unpersisted rooms.
app.post('/api/meetings', async (req, res) => {
    try {
        const response = await fetch(`${MEETING_INTERNAL_URL}/api/meetings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}) },
            body: JSON.stringify(req.body || {}),
            signal: AbortSignal.timeout(5000),
        });
        const body = await response.json().catch(() => ({ error: 'Meeting service returned an invalid response.' }));
        res.setHeader('Cache-Control', 'no-store');
        return res.status(response.status).json(body);
    } catch (error) {
        logger.warn({ error }, 'Could not create meeting through meeting service');
        return res.status(503).json({ error: 'Meeting creation is temporarily unavailable.' });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WEBSOCKET SERVER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.use((_req, res) => { res.status(404).json({ error: 'Route not found' }); });
const server = http.createServer(app);
const wss = attachSignalingWebSocket(server);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GLOBAL ERROR HANDLING (prevent crashes)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

process.on('uncaughtException', (err) => {
    logger.error({ err }, 'Uncaught exception (service kept alive)');
});

process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled rejection (service kept alive)');
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// START
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const HOST = process.env.HOST || '0.0.0.0';
server.listen(config.port, HOST, () => {
    logger.info(`🚀 QS-VC Signaling running on ${HOST}:${config.port}`);
    logger.info(`   WebSocket: ws://${HOST}:${config.port}/ws`);
    logger.info(`   SFU backend: ${config.sfuUrl}`);
    if (config.mcuEnabled) {
        logger.info(`   MCU backend: ${config.mcuUrl}`);
    }
    if (config.hybridMode) {
        logger.info(`   🔀 HYBRID MODE: MCU (Intranet) + SFU (Internet) active`);
    }
});

process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down...');
    wss.close();
    server.close();
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down...');
    wss.close();
    server.close();
    process.exit(0);
});
