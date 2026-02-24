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

const peerIdSchema = z.string().min(1, 'peerId is required').max(128);
const transportIdSchema = z.string().min(1, 'transportId is required').max(128);

const createTransportBody = z.object({
    peerId: peerIdSchema,
    displayName: z.string().max(100).optional(),
    direction: z.enum(['send', 'recv']).default('send'),
});

const connectTransportBody = z.object({
    peerId: peerIdSchema,
    dtlsParameters: z.object({
        role: z.enum(['auto', 'client', 'server']).optional(),
        fingerprints: z.array(z.object({
            algorithm: z.string(),
            value: z.string(),
        })),
    }),
});

const produceBody = z.object({
    peerId: peerIdSchema,
    transportId: transportIdSchema,
    kind: z.enum(['audio', 'video']),
    rtpParameters: z.record(z.unknown()),
    appData: z.record(z.unknown()).optional(),
});

const consumeBody = z.object({
    consumerPeerId: peerIdSchema,
    producerPeerId: peerIdSchema,
    producerId: z.string().min(1).max(128),
    rtpCapabilities: z.record(z.unknown()),
});

const resumeBody = z.object({
    peerId: peerIdSchema,
});

const cascadeNodeBody = z.object({
    nodeId: z.string().min(1).max(128),
    host: z.string().min(1).max(255),
    port: z.number().int().min(1).max(65535),
    maxParticipants: z.number().int().min(1).max(1000).default(50),
});

const cascadeHeartbeatBody = z.object({
    nodeId: z.string().min(1).max(128),
    participantCount: z.number().int().min(0),
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
    : ['http://localhost:5173', 'http://localhost:4001'];
app.use(cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
}));
app.use(express.json());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests, please try again later' } }));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ROOM REGISTRY + CASCADE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const workerManager = new WorkerManager();
const rooms: Map<string, Room> = new Map();
const cascadeManager = new CascadeManager(`sfu-${process.pid}`);

/**
 * Get or create a Room by ID.
 */
async function getOrCreateRoom(roomId: string): Promise<Room> {
    let room = rooms.get(roomId);
    if (room && !room.isClosed()) return room;

    const router = await workerManager.createRouter();
    room = new Room(roomId, router);
    rooms.set(roomId, room);

    room.on('close', () => {
        rooms.delete(roomId);
        logger.info(`Room ${roomId} removed from registry`);
    });

    return room;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API ROUTES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'qsvc-sfu', rooms: rooms.size });
});

// Get router RTP capabilities (needed by client before connecting)
app.get('/api/rooms/:roomId/rtp-capabilities', async (req, res) => {
    try {
        const room = await getOrCreateRoom(req.params.roomId);
        res.json({ rtpCapabilities: room.rtpCapabilities });
    } catch (err: any) {
        logger.error(err, 'Failed to get RTP capabilities');
        res.status(500).json({ error: err.message });
    }
});

// Create WebRTC transport
app.post('/api/rooms/:roomId/transports', validateBody(createTransportBody), async (req, res) => {
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
app.post('/api/rooms/:roomId/transports/:transportId/connect', validateBody(connectTransportBody), async (req, res) => {
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
app.post('/api/rooms/:roomId/produce', validateBody(produceBody), async (req, res) => {
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
app.post('/api/rooms/:roomId/consume', validateBody(consumeBody), async (req, res) => {
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
app.post('/api/rooms/:roomId/consumers/:consumerId/resume', validateBody(resumeBody), async (req, res) => {
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

// Get room info
app.get('/api/rooms/:roomId', async (req, res) => {
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
app.delete('/api/rooms/:roomId/peers/:peerId', async (req, res) => {
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
app.get('/api/cascade/rooms/:roomId/topology', (req, res) => {
    res.json(cascadeManager.getRoomTopology(req.params.roomId));
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GLOBAL ERROR HANDLER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error(err, 'Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// START SERVER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function start(): Promise<void> {
    await workerManager.init();

    app.listen(config.port, () => {
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
