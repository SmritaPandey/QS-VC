/**
 * Unit tests for the Meeting service validation schemas.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Re-define schemas locally (matching meeting/src/index.ts)
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CREATE MEETING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Meeting: createMeetingBody schema', () => {
    it('should accept minimal meeting creation (instant)', () => {
        const result = createMeetingBody.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.type).toBe('instant');
        }
    });

    it('should accept scheduled meeting with full settings', () => {
        const result = createMeetingBody.safeParse({
            title: 'Team Standup',
            type: 'scheduled',
            scheduledStart: '2025-06-15T10:00:00Z',
            scheduledEnd: '2025-06-15T10:30:00Z',
            settings: {
                maxParticipants: 20,
                waitingRoom: true,
                e2eeRequired: true,
            },
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.settings?.maxParticipants).toBe(20);
            expect(result.data.settings?.waitingRoom).toBe(true);
        }
    });

    it('should reject invalid meeting type', () => {
        const result = createMeetingBody.safeParse({ type: 'unknown' });
        expect(result.success).toBe(false);
    });

    it('should reject invalid datetime format', () => {
        const result = createMeetingBody.safeParse({
            scheduledStart: 'not-a-date',
        });
        expect(result.success).toBe(false);
    });

    it('should reject maxParticipants > 500', () => {
        const result = createMeetingBody.safeParse({
            settings: { maxParticipants: 1000 },
        });
        expect(result.success).toBe(false);
    });

    it('should reject maxParticipants < 2', () => {
        const result = createMeetingBody.safeParse({
            settings: { maxParticipants: 1 },
        });
        expect(result.success).toBe(false);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STATUS UPDATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Meeting: updateMeetingStatusBody schema', () => {
    it('should accept valid statuses', () => {
        expect(updateMeetingStatusBody.safeParse({ status: 'waiting' }).success).toBe(true);
        expect(updateMeetingStatusBody.safeParse({ status: 'active' }).success).toBe(true);
        expect(updateMeetingStatusBody.safeParse({ status: 'ended' }).success).toBe(true);
    });

    it('should reject invalid status', () => {
        expect(updateMeetingStatusBody.safeParse({ status: 'paused' }).success).toBe(false);
    });

    it('should reject missing status', () => {
        expect(updateMeetingStatusBody.safeParse({}).success).toBe(false);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// JOIN PARTICIPANT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Meeting: joinParticipantBody schema', () => {
    it('should accept valid participant join', () => {
        const result = joinParticipantBody.safeParse({
            displayName: 'Alice',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.role).toBe('participant'); // default
        }
    });

    it('should accept host role with UUID', () => {
        const result = joinParticipantBody.safeParse({
            userId: '550e8400-e29b-41d4-a716-446655440000',
            displayName: 'Host Bob',
            role: 'host',
            deviceType: 'desktop',
        });
        expect(result.success).toBe(true);
    });

    it('should reject empty displayName', () => {
        expect(joinParticipantBody.safeParse({ displayName: '' }).success).toBe(false);
    });

    it('should strip HTML from displayName', () => {
        const result = joinParticipantBody.safeParse({
            displayName: '<b>Hacker</b><script>x</script>',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.displayName).toBe('Hackerx');
        }
    });

    it('should reject invalid userId UUID', () => {
        const result = joinParticipantBody.safeParse({
            userId: 'not-a-uuid',
            displayName: 'User',
        });
        expect(result.success).toBe(false);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CHAT MESSAGE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Meeting: chatMessageBody schema', () => {
    it('should accept valid text message', () => {
        const result = chatMessageBody.safeParse({
            senderName: 'Alice',
            content: 'Hello, everyone!',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.type).toBe('text');
        }
    });

    it('should strip script tags from content', () => {
        const result = chatMessageBody.safeParse({
            senderName: 'Eve',
            content: 'Hey <script>document.cookie</script> there!',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.content).not.toContain('<script');
            expect(result.data.content).toContain('Hey');
        }
    });

    it('should reject empty content', () => {
        const result = chatMessageBody.safeParse({
            senderName: 'Bob',
            content: '',
        });
        expect(result.success).toBe(false);
    });

    it('should reject missing senderName', () => {
        const result = chatMessageBody.safeParse({
            content: 'No sender',
        });
        expect(result.success).toBe(false);
    });

    it('should accept file message type', () => {
        const result = chatMessageBody.safeParse({
            senderName: 'Alice',
            content: 'document.pdf',
            type: 'file',
        });
        expect(result.success).toBe(true);
    });
});
