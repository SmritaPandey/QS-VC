import { z } from 'zod';

const peerIdSchema = z.string().min(1, 'peerId is required').max(128);
const transportIdSchema = z.string().min(1, 'transportId is required').max(128);

export const createTransportBody = z.object({
    peerId: peerIdSchema,
    displayName: z.string().max(100).optional(),
    direction: z.enum(['send', 'recv']).default('send'),
});

export const connectTransportBody = z.object({
    peerId: peerIdSchema,
    dtlsParameters: z.object({
        role: z.enum(['auto', 'client', 'server']).optional(),
        fingerprints: z.array(z.object({
            algorithm: z.string(),
            value: z.string(),
        })),
    }),
});

export const produceBody = z.object({
    peerId: peerIdSchema,
    transportId: transportIdSchema,
    kind: z.enum(['audio', 'video']),
    rtpParameters: z.record(z.string(), z.unknown()),
    appData: z.record(z.string(), z.unknown()).optional(),
});

export const consumeBody = z.object({
    consumerPeerId: peerIdSchema,
    producerPeerId: peerIdSchema,
    producerId: z.string().min(1).max(128),
    rtpCapabilities: z.record(z.string(), z.unknown()),
});

export const resumeBody = z.object({
    peerId: peerIdSchema,
});

export const cascadeNodeBody = z.object({
    nodeId: z.string().min(1).max(128),
    host: z.string().min(1).max(255),
    port: z.number().int().min(1).max(65535),
    maxParticipants: z.number().int().min(1).max(1000).default(50),
});

export const cascadeHeartbeatBody = z.object({
    nodeId: z.string().min(1).max(128),
    participantCount: z.number().int().min(0),
});

