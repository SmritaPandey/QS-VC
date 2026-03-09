import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import http from 'http';
import url from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { logger } from './logger.js';
import { handleRpcMessage, handlePeerDisconnect } from './rpc/handler.js';
import { roomManager } from './room-manager.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production';
const WEB_URL = (process.env.WEB_URL || 'http://localhost:5173').replace(/\/$/, '');

interface AuthPayload {
    sub: string;
    email: string;
    displayName: string;
    role: string;
    tenantId: string;
}

const app = express();

// CORS: restrict origins per environment
const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
    : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174', 'https://dist-puce-one-68.vercel.app'];
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
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket, req) => {
    // ─── JWT Authentication ───
    let authUser: AuthPayload | null = null;
    try {
        const parsedUrl = url.parse(req.url || '', true);
        const token = (parsedUrl.query.token as string)
            || req.headers.authorization?.replace('Bearer ', '');

        if (token) {
            authUser = jwt.verify(token, JWT_SECRET) as AuthPayload;
            logger.info(`WebSocket authenticated: ${authUser.email} from ${req.socket.remoteAddress}`);
        } else {
            logger.info(`WebSocket connected (guest) from ${req.socket.remoteAddress}`);
        }
    } catch (err) {
        logger.warn(`WebSocket auth failed from ${req.socket.remoteAddress} — allowing as guest`);
    }

    // Per-connection state — carry authenticated identity
    const connectionState: {
        peerId?: string;
        roomId?: string;
        displayName?: string;
        authUser?: AuthPayload | null;
    } = { authUser };

    // Heartbeat
    let isAlive = true;
    ws.on('pong', () => { isAlive = true; });

    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data.toString());

            // Validate JSON-RPC 2.0 format
            if (message.jsonrpc !== '2.0' || !message.method) {
                ws.send(JSON.stringify({
                    jsonrpc: '2.0',
                    id: message.id,
                    error: { code: -32600, message: 'Invalid JSON-RPC 2.0 request' },
                }));
                return;
            }

            logger.debug(`RPC: ${message.method} from ${connectionState.peerId || 'unauthenticated'}`);

            const response = await handleRpcMessage(ws, message, connectionState);
            if (response && message.id !== undefined) {
                ws.send(JSON.stringify(response));
            }
        } catch (err: any) {
            logger.error(err, 'Failed to process WebSocket message');
            ws.send(JSON.stringify({
                jsonrpc: '2.0',
                id: null,
                error: { code: -32700, message: 'Parse error' },
            }));
        }
    });

    ws.on('close', async (code, reason) => {
        logger.info(`WebSocket closed [peer:${connectionState.peerId}] code:${code}`);
        await handlePeerDisconnect(connectionState);
    });

    ws.on('error', (err) => {
        logger.error(err, `WebSocket error [peer:${connectionState.peerId}]`);
    });
});

// Heartbeat interval — detect stale connections
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws: any) => {
        if (!ws.isAlive) {
            logger.warn('Terminating stale WebSocket connection');
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(heartbeatInterval);
});

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

server.listen(config.port, () => {
    logger.info(`🚀 QS-VC Signaling running on port ${config.port}`);
    logger.info(`   WebSocket: ws://localhost:${config.port}/ws`);
    logger.info(`   SFU backend: ${config.sfuUrl}`);
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
