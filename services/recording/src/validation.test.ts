/**
 * Unit tests for the Recording service validation schemas.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Re-define schemas locally (matching recording/src/index.ts)
const startRecordingBody = z.object({
    meetingId: z.string().uuid('Invalid meeting ID'),
    tenantId: z.string().uuid('Invalid tenant ID'),
    type: z.enum(['composite', 'individual', 'audio']).default('composite'),
});

const uploadChunkBody = z.object({
    chunk: z.string().min(1, 'Chunk data is required'),
    chunkIndex: z.number().int().min(0, 'Chunk index must be >= 0'),
    format: z.enum(['webm', 'mp4', 'ogg']).default('webm'),
    isLast: z.boolean().default(false),
});

const completeRecordingBody = z.object({
    data: z.string().min(1, 'Recording data is required'),
    format: z.enum(['webm', 'mp4', 'ogg']).default('webm'),
    durationSec: z.number().min(0).default(0),
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// START RECORDING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Recording: startRecordingBody schema', () => {
    it('should accept valid start recording params', () => {
        const result = startRecordingBody.safeParse({
            meetingId: '550e8400-e29b-41d4-a716-446655440000',
            tenantId: '660e8400-e29b-41d4-a716-446655440000',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.type).toBe('composite');
        }
    });

    it('should accept custom recording type', () => {
        const result = startRecordingBody.safeParse({
            meetingId: '550e8400-e29b-41d4-a716-446655440000',
            tenantId: '660e8400-e29b-41d4-a716-446655440000',
            type: 'audio',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.type).toBe('audio');
        }
    });

    it('should reject invalid meetingId UUID', () => {
        const result = startRecordingBody.safeParse({
            meetingId: 'not-a-uuid',
            tenantId: '660e8400-e29b-41d4-a716-446655440000',
        });
        expect(result.success).toBe(false);
    });

    it('should reject invalid recording type', () => {
        const result = startRecordingBody.safeParse({
            meetingId: '550e8400-e29b-41d4-a716-446655440000',
            tenantId: '660e8400-e29b-41d4-a716-446655440000',
            type: 'mp3',
        });
        expect(result.success).toBe(false);
    });

    it('should reject missing required fields', () => {
        expect(startRecordingBody.safeParse({}).success).toBe(false);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UPLOAD CHUNK
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Recording: uploadChunkBody schema', () => {
    it('should accept valid chunk upload', () => {
        const result = uploadChunkBody.safeParse({
            chunk: 'base64encodeddata...',
            chunkIndex: 0,
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.format).toBe('webm');
            expect(result.data.isLast).toBe(false);
        }
    });

    it('should accept final chunk with mp4 format', () => {
        const result = uploadChunkBody.safeParse({
            chunk: 'base64data',
            chunkIndex: 5,
            format: 'mp4',
            isLast: true,
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.isLast).toBe(true);
            expect(result.data.format).toBe('mp4');
        }
    });

    it('should reject empty chunk', () => {
        const result = uploadChunkBody.safeParse({
            chunk: '',
            chunkIndex: 0,
        });
        expect(result.success).toBe(false);
    });

    it('should reject negative chunkIndex', () => {
        const result = uploadChunkBody.safeParse({
            chunk: 'data',
            chunkIndex: -1,
        });
        expect(result.success).toBe(false);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMPLETE RECORDING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Recording: completeRecordingBody schema', () => {
    it('should accept valid complete recording', () => {
        const result = completeRecordingBody.safeParse({
            data: 'base64fullrecording...',
            format: 'webm',
            durationSec: 3600,
        });
        expect(result.success).toBe(true);
    });

    it('should default format to webm', () => {
        const result = completeRecordingBody.safeParse({
            data: 'base64data',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.format).toBe('webm');
            expect(result.data.durationSec).toBe(0);
        }
    });

    it('should reject empty data', () => {
        const result = completeRecordingBody.safeParse({
            data: '',
        });
        expect(result.success).toBe(false);
    });

    it('should reject negative duration', () => {
        const result = completeRecordingBody.safeParse({
            data: 'base64data',
            durationSec: -10,
        });
        expect(result.success).toBe(false);
    });
});
