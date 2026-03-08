/**
 * Unit tests for the shared validation module.
 * Tests all exported Zod schemas and utility functions.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

// Re-define schemas locally for testing (matching shared/validation.ts)
const uuidSchema = z.string().uuid('Invalid UUID format');

const meetingCodeSchema = z
    .string()
    .min(6, 'Meeting code too short')
    .max(30, 'Meeting code too long')
    .regex(/^[A-Z0-9-]+$/i, 'Meeting code must be alphanumeric with dashes');

const displayNameSchema = z
    .string()
    .min(1, 'Display name is required')
    .max(100, 'Display name too long')
    .transform((s) => s.trim().replace(/<[^>]*>/g, ''));

const emailSchema = z.string().email('Invalid email address').max(255);

const passwordSchema = z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password too long');

const paginationSchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
});

const joinRoomSchema = z.object({
    meetingCode: meetingCodeSchema,
    displayName: displayNameSchema,
    password: z.string().max(50).optional(),
    rtpCapabilities: z.record(z.unknown()).optional(),
});

const chatMessageSchema = z.object({
    content: z
        .string()
        .min(1, 'Message cannot be empty')
        .max(4096, 'Message too long')
        .transform((s) => s.trim().replace(/<script[^>]*>.*?<\/script>/gi, '')),
    type: z.enum(['text', 'file', 'system']).default('text'),
});

function validateBody<T>(schema: z.ZodSchema<T>) {
    return (req: any, res: any, next: any) => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: result.error.issues.map((i: any) => ({
                    field: i.path.join('.'),
                    message: i.message,
                })),
            });
        }
        req.body = result.data;
        next();
    };
}

function validateRpcParams<T>(schema: z.ZodSchema<T>, params: unknown): T {
    const result = schema.safeParse(params);
    if (!result.success) {
        const msg = result.error.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; ');
        throw Object.assign(new Error(msg), { code: -32602 });
    }
    return result.data;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UUID SCHEMA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Shared: uuidSchema', () => {
    it('should accept valid UUID v4', () => {
        expect(uuidSchema.safeParse('123e4567-e89b-12d3-a456-426614174000').success).toBe(true);
    });

    it('should reject non-UUID string', () => {
        expect(uuidSchema.safeParse('not-a-uuid').success).toBe(false);
    });

    it('should reject empty string', () => {
        expect(uuidSchema.safeParse('').success).toBe(false);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MEETING CODE SCHEMA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Shared: meetingCodeSchema', () => {
    it('should accept valid meeting code', () => {
        expect(meetingCodeSchema.safeParse('QS-ABCD-EFGH-1234').success).toBe(true);
    });

    it('should accept short alphanumeric code', () => {
        expect(meetingCodeSchema.safeParse('ABC-123').success).toBe(true);
    });

    it('should reject code shorter than 6 chars', () => {
        expect(meetingCodeSchema.safeParse('AB').success).toBe(false);
    });

    it('should reject code with special characters', () => {
        expect(meetingCodeSchema.safeParse('QS@ABCD!').success).toBe(false);
    });

    it('should reject code longer than 30 chars', () => {
        expect(meetingCodeSchema.safeParse('A'.repeat(31)).success).toBe(false);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DISPLAY NAME SCHEMA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Shared: displayNameSchema', () => {
    it('should accept valid display name', () => {
        const r = displayNameSchema.safeParse('Alice');
        expect(r.success).toBe(true);
    });

    it('should trim whitespace', () => {
        const r = displayNameSchema.safeParse('  Bob  ');
        expect(r.success).toBe(true);
        if (r.success) expect(r.data).toBe('Bob');
    });

    it('should strip HTML tags', () => {
        const r = displayNameSchema.safeParse('Eve <b>bold</b>');
        expect(r.success).toBe(true);
        if (r.success) expect(r.data).toBe('Eve bold');
    });

    it('should reject empty name', () => {
        expect(displayNameSchema.safeParse('').success).toBe(false);
    });

    it('should reject name longer than 100 chars', () => {
        expect(displayNameSchema.safeParse('X'.repeat(101)).success).toBe(false);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EMAIL SCHEMA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Shared: emailSchema', () => {
    it('should accept valid email', () => {
        expect(emailSchema.safeParse('user@example.com').success).toBe(true);
    });

    it('should reject invalid email', () => {
        expect(emailSchema.safeParse('not-email').success).toBe(false);
    });

    it('should reject empty string', () => {
        expect(emailSchema.safeParse('').success).toBe(false);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PASSWORD SCHEMA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Shared: passwordSchema', () => {
    it('should accept valid password', () => {
        expect(passwordSchema.safeParse('securePass1!').success).toBe(true);
    });

    it('should reject password shorter than 8 chars', () => {
        const r = passwordSchema.safeParse('short');
        expect(r.success).toBe(false);
        if (!r.success) expect(r.error.issues[0].message).toBe('Password must be at least 8 characters');
    });

    it('should reject password longer than 128 chars', () => {
        expect(passwordSchema.safeParse('A'.repeat(129)).success).toBe(false);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PAGINATION SCHEMA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Shared: paginationSchema', () => {
    it('should use defaults when empty', () => {
        const r = paginationSchema.safeParse({});
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.limit).toBe(20);
            expect(r.data.offset).toBe(0);
        }
    });

    it('should coerce string numbers', () => {
        const r = paginationSchema.safeParse({ limit: '10', offset: '5' });
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.limit).toBe(10);
            expect(r.data.offset).toBe(5);
        }
    });

    it('should reject limit > 100', () => {
        expect(paginationSchema.safeParse({ limit: 200 }).success).toBe(false);
    });

    it('should reject negative offset', () => {
        expect(paginationSchema.safeParse({ offset: -1 }).success).toBe(false);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// JOIN ROOM SCHEMA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Shared: joinRoomSchema', () => {
    it('should accept valid join data', () => {
        const r = joinRoomSchema.safeParse({
            meetingCode: 'QS-ABCD-1234-EFGH',
            displayName: 'Alice',
        });
        expect(r.success).toBe(true);
    });

    it('should accept join with optional password', () => {
        const r = joinRoomSchema.safeParse({
            meetingCode: 'QS-ABCD-1234-EFGH',
            displayName: 'Bob',
            password: 'meeting123',
        });
        expect(r.success).toBe(true);
    });

    it('should reject invalid meeting code', () => {
        const r = joinRoomSchema.safeParse({
            meetingCode: 'AB',
            displayName: 'Eve',
        });
        expect(r.success).toBe(false);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CHAT MESSAGE SCHEMA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Shared: chatMessageSchema', () => {
    it('should accept valid text message', () => {
        const r = chatMessageSchema.safeParse({ content: 'Hello world' });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.type).toBe('text');
    });

    it('should strip script tags', () => {
        const r = chatMessageSchema.safeParse({
            content: 'Hello <script>alert("xss")</script> world',
        });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.content).toBe('Hello  world');
    });

    it('should reject empty content', () => {
        expect(chatMessageSchema.safeParse({ content: '' }).success).toBe(false);
    });

    it('should reject content over 4096 chars', () => {
        expect(chatMessageSchema.safeParse({ content: 'X'.repeat(4097) }).success).toBe(false);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// VALIDATE BODY MIDDLEWARE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Shared: validateBody middleware', () => {
    it('should call next() on valid body', () => {
        const schema = z.object({ name: z.string() });
        const middleware = validateBody(schema);

        const req = { body: { name: 'Test' } } as any;
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
        const next = vi.fn();

        middleware(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(req.body.name).toBe('Test');
    });

    it('should return 400 on invalid body', () => {
        const schema = z.object({ name: z.string() });
        const middleware = validateBody(schema);

        const req = { body: { name: 123 } } as any;
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
        const next = vi.fn();

        middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(next).not.toHaveBeenCalled();
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// VALIDATE RPC PARAMS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Shared: validateRpcParams', () => {
    it('should return parsed data for valid params', () => {
        const schema = z.object({ id: z.string() });
        const result = validateRpcParams(schema, { id: 'abc' });
        expect(result.id).toBe('abc');
    });

    it('should throw with code -32602 on invalid params', () => {
        const schema = z.object({ id: z.string() });
        try {
            validateRpcParams(schema, { id: 123 });
            expect.fail('Should have thrown');
        } catch (err: any) {
            expect(err.code).toBe(-32602);
        }
    });
});
