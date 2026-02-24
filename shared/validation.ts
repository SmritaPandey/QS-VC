/**
 * Shared Zod validation schemas for QS-VC services.
 * Import from '../../../shared/validation' or copy as needed.
 */
import { z } from 'zod';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PRIMITIVES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const uuidSchema = z.string().uuid('Invalid UUID format');

export const meetingCodeSchema = z
    .string()
    .min(6, 'Meeting code too short')
    .max(30, 'Meeting code too long')
    .regex(/^[A-Z0-9-]+$/i, 'Meeting code must be alphanumeric with dashes');

export const displayNameSchema = z
    .string()
    .min(1, 'Display name is required')
    .max(100, 'Display name too long')
    .transform((s) => s.trim().replace(/<[^>]*>/g, ''));  // Strip HTML tags

export const emailSchema = z.string().email('Invalid email address').max(255);

export const passwordSchema = z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password too long');

export const paginationSchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SFU SCHEMAS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const createRoomSchema = z.object({
    roomId: z.string().optional(),
});

export const createTransportSchema = z.object({
    roomId: uuidSchema,
    peerId: z.string().min(1).max(128),
});

export const connectTransportSchema = z.object({
    roomId: uuidSchema,
    peerId: z.string().min(1).max(128),
    transportId: z.string().min(1).max(128),
    dtlsParameters: z.object({
        role: z.enum(['auto', 'client', 'server']).optional(),
        fingerprints: z.array(z.object({
            algorithm: z.string(),
            value: z.string(),
        })),
    }),
});

export const produceSchema = z.object({
    roomId: uuidSchema,
    peerId: z.string().min(1).max(128),
    transportId: z.string().min(1).max(128),
    kind: z.enum(['audio', 'video']),
    rtpParameters: z.record(z.unknown()),
    appData: z.record(z.unknown()).optional(),
});

export const consumeSchema = z.object({
    roomId: uuidSchema,
    peerId: z.string().min(1).max(128),
    producerId: z.string().min(1).max(128),
    rtpCapabilities: z.record(z.unknown()),
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SIGNALING SCHEMAS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const joinRoomSchema = z.object({
    meetingCode: meetingCodeSchema,
    displayName: displayNameSchema,
    password: z.string().max(50).optional(),
    rtpCapabilities: z.record(z.unknown()).optional(),
});

export const chatMessageSchema = z.object({
    content: z
        .string()
        .min(1, 'Message cannot be empty')
        .max(4096, 'Message too long')
        .transform((s) => s.trim().replace(/<script[^>]*>.*?<\/script>/gi, '')),  // Strip script tags
    type: z.enum(['text', 'file', 'system']).default('text'),
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AUTH SCHEMAS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const registerSchema = z.object({
    email: emailSchema,
    displayName: displayNameSchema,
    password: passwordSchema,
    tenantId: uuidSchema.optional(),
});

export const loginSchema = z.object({
    email: emailSchema,
    password: z.string().min(1, 'Password is required').max(128),
});

export const updateProfileSchema = z.object({
    displayName: displayNameSchema.optional(),
    avatarUrl: z.string().url().max(2048).optional(),
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MEETING SCHEMAS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const createMeetingSchema = z.object({
    title: z.string().max(255).optional(),
    type: z.enum(['instant', 'scheduled', 'recurring']).default('instant'),
    scheduledStart: z.string().datetime().optional(),
    scheduledEnd: z.string().datetime().optional(),
    settings: z.object({
        maxParticipants: z.number().int().min(2).max(500).optional(),
        waitingRoom: z.boolean().optional(),
        e2eeRequired: z.boolean().optional(),
        recordingAllowed: z.boolean().optional(),
        chatEnabled: z.boolean().optional(),
        screenShareEnabled: z.boolean().optional(),
    }).optional(),
});

export const updateMeetingStatusSchema = z.object({
    status: z.enum(['waiting', 'active', 'ended']),
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RECORDING SCHEMAS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const startRecordingSchema = z.object({
    meetingId: uuidSchema,
    tenantId: uuidSchema,
    type: z.enum(['composite', 'individual', 'audio']).default('composite'),
});

export const uploadChunkSchema = z.object({
    chunk: z.string().min(1, 'Chunk data is required'),
    chunkIndex: z.number().int().min(0),
    format: z.enum(['webm', 'mp4', 'ogg']).default('webm'),
    isLast: z.boolean().default(false),
});

export const completeRecordingSchema = z.object({
    data: z.string().min(1, 'Recording data is required'),
    format: z.enum(['webm', 'mp4', 'ogg']).default('webm'),
    durationSec: z.number().min(0).default(0),
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UTILITY: Express middleware validator
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Express middleware that validates req.body against a Zod schema.
 * On failure, returns 400 with structured error details.
 */
export function validateBody<T>(schema: z.ZodSchema<T>) {
    return (req: any, res: any, next: any) => {
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
        req.body = result.data;  // Use parsed/transformed data
        next();
    };
}

/**
 * Validates RPC params and returns parsed data or throws.
 */
export function validateRpcParams<T>(schema: z.ZodSchema<T>, params: unknown): T {
    const result = schema.safeParse(params);
    if (!result.success) {
        const msg = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
        throw Object.assign(new Error(msg), { code: -32602 });  // JSON-RPC Invalid params
    }
    return result.data;
}
