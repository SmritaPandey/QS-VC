/**
 * Unit tests for the SFU service validation schemas.
 * Tests Zod schemas for transport, produce, consume, and cascade operations.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Re-define schemas locally for testing (matching sfu/src/index.ts)
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
    rtpParameters: z.record(z.string(), z.unknown()),
    appData: z.record(z.string(), z.unknown()).optional(),
});

const consumeBody = z.object({
    consumerPeerId: peerIdSchema,
    producerPeerId: peerIdSchema,
    producerId: z.string().min(1).max(128),
    rtpCapabilities: z.record(z.string(), z.unknown()),
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CREATE TRANSPORT TESTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('SFU: createTransportBody schema', () => {
    it('should accept valid transport creation with peerId only', () => {
        const result = createTransportBody.safeParse({ peerId: 'peer-123' });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.direction).toBe('send'); // default
        }
    });

    it('should accept recv direction', () => {
        const result = createTransportBody.safeParse({ peerId: 'peer-1', direction: 'recv' });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.direction).toBe('recv');
        }
    });

    it('should accept optional displayName', () => {
        const result = createTransportBody.safeParse({ peerId: 'peer-1', displayName: 'Alice' });
        expect(result.success).toBe(true);
    });

    it('should reject empty peerId', () => {
        const result = createTransportBody.safeParse({ peerId: '' });
        expect(result.success).toBe(false);
    });

    it('should reject invalid direction', () => {
        const result = createTransportBody.safeParse({ peerId: 'peer-1', direction: 'both' });
        expect(result.success).toBe(false);
    });

    it('should reject missing peerId', () => {
        const result = createTransportBody.safeParse({});
        expect(result.success).toBe(false);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONNECT TRANSPORT TESTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('SFU: connectTransportBody schema', () => {
    const validDtls = {
        fingerprints: [{ algorithm: 'sha-256', value: 'AB:CD:EF:01:23:45' }],
    };

    it('should accept valid connect data', () => {
        const result = connectTransportBody.safeParse({
            peerId: 'peer-1',
            dtlsParameters: validDtls,
        });
        expect(result.success).toBe(true);
    });

    it('should accept dtlsParameters with optional role', () => {
        const result = connectTransportBody.safeParse({
            peerId: 'peer-1',
            dtlsParameters: { ...validDtls, role: 'client' },
        });
        expect(result.success).toBe(true);
    });

    it('should reject missing fingerprints', () => {
        const result = connectTransportBody.safeParse({
            peerId: 'peer-1',
            dtlsParameters: {},
        });
        expect(result.success).toBe(false);
    });

    it('should reject missing dtlsParameters', () => {
        const result = connectTransportBody.safeParse({ peerId: 'peer-1' });
        expect(result.success).toBe(false);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PRODUCE TESTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('SFU: produceBody schema', () => {
    it('should accept valid produce data', () => {
        const result = produceBody.safeParse({
            peerId: 'peer-1',
            transportId: 'transport-abc',
            kind: 'audio',
            rtpParameters: { codecs: [] },
        });
        expect(result.success).toBe(true);
    });

    it('should accept video kind with appData', () => {
        const result = produceBody.safeParse({
            peerId: 'peer-1',
            transportId: 'transport-abc',
            kind: 'video',
            rtpParameters: { codecs: [] },
            appData: { source: 'webcam' },
        });
        expect(result.success).toBe(true);
    });

    it('should reject invalid kind', () => {
        const result = produceBody.safeParse({
            peerId: 'peer-1',
            transportId: 'transport-abc',
            kind: 'data',
            rtpParameters: {},
        });
        expect(result.success).toBe(false);
    });

    it('should reject missing transportId', () => {
        const result = produceBody.safeParse({
            peerId: 'peer-1',
            kind: 'audio',
            rtpParameters: {},
        });
        expect(result.success).toBe(false);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONSUME TESTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('SFU: consumeBody schema', () => {
    it('should accept valid consume data', () => {
        const result = consumeBody.safeParse({
            consumerPeerId: 'peer-A',
            producerPeerId: 'peer-B',
            producerId: 'prod-123',
            rtpCapabilities: { codecs: [], headerExtensions: [] },
        });
        expect(result.success).toBe(true);
    });

    it('should reject missing producerPeerId', () => {
        const result = consumeBody.safeParse({
            consumerPeerId: 'peer-A',
            producerId: 'prod-123',
            rtpCapabilities: {},
        });
        expect(result.success).toBe(false);
    });

    it('should reject empty consumerPeerId', () => {
        const result = consumeBody.safeParse({
            consumerPeerId: '',
            producerPeerId: 'peer-B',
            producerId: 'prod-123',
            rtpCapabilities: {},
        });
        expect(result.success).toBe(false);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RESUME TESTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('SFU: resumeBody schema', () => {
    it('should accept valid peerId', () => {
        expect(resumeBody.safeParse({ peerId: 'peer-1' }).success).toBe(true);
    });

    it('should reject empty peerId', () => {
        expect(resumeBody.safeParse({ peerId: '' }).success).toBe(false);
    });

    it('should reject missing peerId', () => {
        expect(resumeBody.safeParse({}).success).toBe(false);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CASCADE NODE TESTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('SFU: cascadeNodeBody schema', () => {
    it('should accept valid cascade node', () => {
        const result = cascadeNodeBody.safeParse({
            nodeId: 'sfu-node-2',
            host: '10.0.0.5',
            port: 4000,
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.maxParticipants).toBe(50); // default
        }
    });

    it('should accept custom maxParticipants', () => {
        const result = cascadeNodeBody.safeParse({
            nodeId: 'sfu-node-3',
            host: 'sfu3.qsvc.dev',
            port: 4000,
            maxParticipants: 200,
        });
        expect(result.success).toBe(true);
    });

    it('should reject port > 65535', () => {
        const result = cascadeNodeBody.safeParse({
            nodeId: 'sfu-node-1',
            host: '10.0.0.5',
            port: 70000,
        });
        expect(result.success).toBe(false);
    });

    it('should reject port 0', () => {
        const result = cascadeNodeBody.safeParse({
            nodeId: 'sfu-node-1',
            host: '10.0.0.5',
            port: 0,
        });
        expect(result.success).toBe(false);
    });

    it('should reject maxParticipants > 1000', () => {
        const result = cascadeNodeBody.safeParse({
            nodeId: 'sfu-1',
            host: 'x.com',
            port: 4000,
            maxParticipants: 9999,
        });
        expect(result.success).toBe(false);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CASCADE HEARTBEAT TESTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('SFU: cascadeHeartbeatBody schema', () => {
    it('should accept valid heartbeat', () => {
        const result = cascadeHeartbeatBody.safeParse({
            nodeId: 'sfu-node-1',
            participantCount: 15,
        });
        expect(result.success).toBe(true);
    });

    it('should accept zero participants', () => {
        const result = cascadeHeartbeatBody.safeParse({
            nodeId: 'sfu-node-1',
            participantCount: 0,
        });
        expect(result.success).toBe(true);
    });

    it('should reject negative participantCount', () => {
        const result = cascadeHeartbeatBody.safeParse({
            nodeId: 'sfu-node-1',
            participantCount: -1,
        });
        expect(result.success).toBe(false);
    });

    it('should reject missing nodeId', () => {
        const result = cascadeHeartbeatBody.safeParse({ participantCount: 5 });
        expect(result.success).toBe(false);
    });
});
