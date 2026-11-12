import { createPolyAdapter } from './poly-adapter.js';
import { resolve } from 'node:path';
import { authorizedControlRequest } from './control-auth.js';
import { coalesceRoomCreation } from './room-creation.js';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { logger } from './logger.js';
import { WorkerManager } from './mediasoup/worker-manager.js';
import { Room } from './mediasoup/room.js';
import { CascadeManager } from './mediasoup/cascade-manager.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// VALIDATION SCHEMAS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { createTransportBody, connectTransportBody, produceBody, consumeBody, resumeBody, producerControlBody, cascadeNodeBody, cascadeHeartbeatBody } from './validation.js';

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
app.disable('x-powered-by');

// CORS: restrict origins per environment
const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
    : ['http://localhost:5173', 'http://localhost:4001'];
app.use(cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
}));
const controlToken = process.env.SFU_CONTROL_TOKEN;
if (process.env.NODE_ENV === 'production' && !controlToken) {
    throw new Error('SFU_CONTROL_TOKEN is required in production');
}
app.use('/api', (req, res, next) => {
    if (controlToken && !authorizedControlRequest(req.headers.authorization, controlToken)) {
        return res.status(401).json({ error: 'Unauthorized SFU control request' });
    }
    next();
});
app.use('/api', rateLimit({
    windowMs: 60_000,
    max: controlToken ? 1200 : 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many SFU control requests' },
}));
app.use(express.json());

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ROOM REGISTRY + CASCADE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const workerManager = new WorkerManager();
const rooms: Map<string, Room> = new Map();
const cascadeManager = new CascadeManager(`sfu-${process.pid}`);

let onPolyRoomCreated: ((room: Room) => void) | undefined;

const createRoom = coalesceRoomCreation(async roomId => {
    const router = await workerManager.createRouter();
    const room = new Room(roomId, router);
    rooms.set(roomId, room);
    onPolyRoomCreated?.(room);

    room.on('close', () => {
        if (rooms.get(roomId) === room) rooms.delete(roomId);
        logger.info(`Room ${roomId} removed from registry`);
    });
    return room;
});

async function getOrCreateRoom(roomId: string): Promise<Room> {
    const room = rooms.get(roomId);
    return room && !room.isClosed() ? room : createRoom(roomId);
}

function mountPolyBridge() {
    const modulePath = process.env.POLY_BRIDGE_MODULE;
    if (!modulePath) return;
    if (!controlToken || process.env.BRIDGE_API_TOKEN !== controlToken) {
        throw new Error('Poly bridge requires matching SFU_CONTROL_TOKEN and BRIDGE_API_TOKEN');
    }
    const adapter = createPolyAdapter(id => rooms.get(id), getOrCreateRoom);
    const { createPolyBridge } = require(resolve(modulePath));
    const bridge = createPolyBridge(adapter);
    app.get('/api/poly/rooms/:room/snapshot', (req, res) => {
        if (!rooms.has(req.params.room)) return res.status(404).json({ error: 'QSVC media room unavailable' });
        res.json(adapter.snapshot(req.params.room));
    });
    app.use('/api/poly', bridge.http);
    const watch = (room: Room) => room.once('close', () => {
        void bridge.stopRoom(room.id).catch((err: Error) => logger.warn(err, 'Poly room teardown failed'));
    });
    for (const room of rooms.values()) watch(room);
    onPolyRoomCreated = watch;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API ROUTES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'qsvc-sfu', rooms: rooms.size });
});

// Get router RTP capabilities (needed by client before connecting)
app.get<{ roomId: string }>('/api/rooms/:roomId/rtp-capabilities', async (req, res) => {
    try {
        const room = await getOrCreateRoom(req.params.roomId);
        res.json({ rtpCapabilities: room.rtpCapabilities });
    } catch (err: any) {
        logger.error(err, 'Failed to get RTP capabilities');
        res.status(500).json({ error: err.message });
    }
});

// Create WebRTC transport
app.post<{ roomId: string }>('/api/rooms/:roomId/transports', validateBody(createTransportBody), async (req, res) => {
    try {
        const { peerId, direction } = req.body;
        const room = await getOrCreateRoom(req.params.roomId);

        // Ensure peer exists in room
        let peer = room.getPeer(peerId);
        if (!peer) {
            const { Peer } = await import('./mediasoup/peer.js');
            peer = new Peer(peerId, req.body.displayName || 'Guest');
            room.addPeer(peer);
        }

        const transport = await room.createWebRtcTransport(peerId);
        // Tag transport direction for later identification
        (transport.appData as any).direction = direction || 'send';

        res.json({
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
            sctpParameters: transport.sctpParameters,
        });
    } catch (err: any) {
        logger.error(err, 'Failed to create transport');
        res.status(500).json({ error: err.message });
    }
});

// Connect transport (DTLS handshake)
app.post<{ roomId: string; transportId: string }>('/api/rooms/:roomId/transports/:transportId/connect', validateBody(connectTransportBody), async (req, res) => {
    try {
        const { peerId, dtlsParameters } = req.body;
        const room = rooms.get(req.params.roomId);
        if (!room) return res.status(404).json({ error: 'Room not found' });

        const peer = room.getPeer(peerId);
        if (!peer) return res.status(404).json({ error: 'Peer not found' });

        const transport = peer.getTransport(req.params.transportId);
        if (!transport) return res.status(404).json({ error: 'Transport not found' });

        await transport.connect({ dtlsParameters });
        res.json({ connected: true });
    } catch (err: any) {
        logger.error(err, 'Failed to connect transport');
        res.status(500).json({ error: err.message });
    }
});

// Produce (publish media)
app.post<{ roomId: string }>('/api/rooms/:roomId/produce', validateBody(produceBody), async (req, res) => {
    try {
        const { peerId, transportId, kind, rtpParameters, appData } = req.body;
        const room = rooms.get(req.params.roomId);
        if (!room) return res.status(404).json({ error: 'Room not found' });

        const producer = await room.createProducer(peerId, transportId, kind, rtpParameters, appData);
        res.json({ producerId: producer.id });
    } catch (err: any) {
        logger.error(err, 'Failed to produce');
        res.status(500).json({ error: err.message });
    }
});

// Consume (receive media from a specific producer)
app.post<{ roomId: string }>('/api/rooms/:roomId/consume', validateBody(consumeBody), async (req, res) => {
    try {
        const { consumerPeerId, producerPeerId, producerId, rtpCapabilities } = req.body;
        const room = rooms.get(req.params.roomId);
        if (!room) return res.status(404).json({ error: 'Room not found' });

        const consumer = await room.createConsumer(consumerPeerId, producerPeerId, producerId, rtpCapabilities);
        if (!consumer) {
            return res.status(400).json({ error: 'Cannot consume this producer' });
        }

        res.json({
            consumerId: consumer.id,
            producerId: consumer.producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            appData: consumer.appData,
        });
    } catch (err: any) {
        logger.error(err, 'Failed to consume');
        res.status(500).json({ error: err.message });
    }
});

// Resume consumer (client sends this after setting up its recv transport)
app.post<{ roomId: string; consumerId: string }>('/api/rooms/:roomId/consumers/:consumerId/resume', validateBody(resumeBody), async (req, res) => {
    try {
        const { peerId } = req.body;
        const room = rooms.get(req.params.roomId);
        if (!room) return res.status(404).json({ error: 'Room not found' });

        const peer = room.getPeer(peerId);
        if (!peer) return res.status(404).json({ error: 'Peer not found' });

        const consumer = peer.getConsumer(req.params.consumerId);
        if (!consumer) return res.status(404).json({ error: 'Consumer not found' });

        await consumer.resume();
        res.json({ resumed: true });
    } catch (err: any) {
        logger.error(err, 'Failed to resume consumer');
        res.status(500).json({ error: err.message });
    }
});

app.post<{ roomId: string; producerId: string }>('/api/rooms/:roomId/producers/:producerId/close', validateBody(producerControlBody), (req, res) => {
    const room = rooms.get(req.params.roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const peer = room.getPeer(req.body.peerId);
    if (!peer) return res.status(404).json({ error: 'Peer not found' });
    if (!peer.closeProducer(req.params.producerId)) return res.status(404).json({ error: 'Producer not found' });
    res.json({ closed: true });
});

app.post<{ roomId: string; producerId: string }>('/api/rooms/:roomId/producers/:producerId/pause', validateBody(producerControlBody), (req, res) => {
    if (req.body.paused === undefined) return res.status(400).json({ error: 'paused is required' });
    const room = rooms.get(req.params.roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const peer = room.getPeer(req.body.peerId);
    if (!peer) return res.status(404).json({ error: 'Peer not found' });
    if (!peer.setProducerPaused(req.params.producerId, req.body.paused)) return res.status(404).json({ error: 'Producer not found' });
    res.json({ paused: req.body.paused });
});

// Get room info
app.get<{ roomId: string }>('/api/rooms/:roomId', async (req, res) => {
    const room = rooms.get(req.params.roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json(room.toJSON());
});

// Get all rooms
app.get('/api/rooms', (_req, res) => {
    const roomList = Array.from(rooms.values()).map((r) => r.toJSON());
    res.json({ rooms: roomList, count: roomList.length });
});

// Worker stats
app.get('/api/stats/workers', async (_req, res) => {
    const stats = await workerManager.getStats();
    res.json({ workers: stats });
});

// Remove peer from room
app.delete<{ roomId: string; peerId: string }>('/api/rooms/:roomId/peers/:peerId', async (req, res) => {
    const room = rooms.get(req.params.roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    room.removePeer(req.params.peerId);
    res.json({ removed: true });
});

// Cascade stats
app.get('/api/cascade/stats', (_req, res) => {
    res.json(cascadeManager.getStats());
});

// Cascade node registration
app.post('/api/cascade/nodes', validateBody(cascadeNodeBody), (req, res) => {
    const { nodeId, host, port, maxParticipants } = req.body;
    cascadeManager.registerNode({
        nodeId, host, port,
        health: 'healthy',
        participantCount: 0,
        maxParticipants: maxParticipants || 50,
        lastHeartbeat: Date.now(),
    });
    res.json({ registered: true });
});

// Cascade heartbeat
app.post('/api/cascade/heartbeat', validateBody(cascadeHeartbeatBody), (req, res) => {
    const { nodeId, participantCount } = req.body;
    cascadeManager.updateNodeHealth(nodeId, participantCount);
    res.json({ ok: true });
});

// Get room cascade topology
app.get<{ roomId: string }>('/api/cascade/rooms/:roomId/topology', (req, res) => {
    res.json(cascadeManager.getRoomTopology(req.params.roomId));
});

mountPolyBridge();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GLOBAL ERROR HANDLER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.use((_req, res) => { res.status(404).json({ error: 'Route not found' }); });
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error(err, 'Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// START SERVER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function start(): Promise<void> {
    await workerManager.init();

    app.listen(config.port, process.env.SFU_CONTROL_HOST || '0.0.0.0', () => {
        logger.info(`🚀 QS-VC SFU running on port ${config.port}`);
        logger.info(`   Workers: ${config.numWorkers}`);
        logger.info(`   RTC ports: ${config.worker.rtcMinPort}-${config.worker.rtcMaxPort}`);
        logger.info(`   Announced IP: ${config.announcedIp}`);
    });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down...');
    await workerManager.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down...');
    await workerManager.close();
    process.exit(0);
});

start().catch((err) => {
    logger.fatal(err, 'Failed to start SFU');
    process.exit(1);
});
