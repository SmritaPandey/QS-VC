import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import http from 'http';
import { config } from './config.js';
import { logger } from './logger.js';
import { roomManager } from './room-manager.js';
import { attachSignalingWebSocket } from './ws-attach.js';

const WEB_URL = (process.env.WEB_URL || 'https://qs-vc.vercel.app').replace(/\/$/, '');

const app = express();
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

app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        service: 'qsvc-signaling',
        rooms: roomManager.getRoomCount(),
    });
});

// Generate a simple meeting code
app.post('/api/meetings/create', (_req, res) => {
    const code = generateMeetingCode();
    res.json({ meetingCode: code, joinUrl: `${WEB_URL}/meeting/${code}` });
});

// Return ICE servers (STUN + TURN) for WebRTC NAT traversal
app.get('/api/ice-servers', (_req, res) => {
    res.json({ iceServers: config.iceServers });
});

// Schedule or create a meeting (handles the meeting-service API contract)
app.post('/api/meetings', express.json(), (req, res) => {
    const code = generateMeetingCode();
    const { title, type, scheduledStart, scheduledEnd, settings } = req.body || {};

    // Store in-memory for the session (production would persist to DB)
    const meeting = {
        id: `mtg-${Date.now()}`,
        meetingCode: code,
        code,
        title: title || 'Meeting',
        type: type || 'instant',
        scheduledStart: scheduledStart || null,
        scheduledEnd: scheduledEnd || null,
        settings: settings || {},
        status: type === 'scheduled' ? 'waiting' : 'active',
        createdAt: new Date().toISOString(),
        joinUrl: `${WEB_URL}/meeting/${code}/preview`,
    };

    logger.info(`Meeting created: ${code} (${meeting.type})`);
    res.json(meeting);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WEBSOCKET SERVER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const server = http.createServer(app);
const wss = attachSignalingWebSocket(server);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
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
