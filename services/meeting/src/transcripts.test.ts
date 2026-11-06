import { describe, expect, it } from 'vitest';
import { transcriptAsSrt, transcriptAsText, transcriptBody } from './transcripts';

const rows = [
    { segment_id: 'a', speaker: 'Asha', language: 'hi', text: 'नमस्ते', spoken_at: '2026-11-06T10:00:00.000Z' },
    { segment_id: 'b', speaker: 'Ravi', language: 'en', text: 'Budget approved', spoken_at: '2026-11-06T10:00:02.500Z' },
];
describe('transcript export', () => {
    it('writes plain text with minutes first', () => {
        expect(transcriptAsText(rows, '## Summary\n- ok')).toBe('## Summary\n- ok\n\n---\n\nTranscript\n\n[10:00:00] Asha: नमस्ते\n[10:00:02] Ravi: Budget approved\n');
    });
    it('writes valid SRT cues', () => {
        expect(transcriptAsSrt(rows)).toBe('1\n00:00:00,000 --> 00:00:02,500\nAsha: नमस्ते\n\n2\n00:00:02,500 --> 00:00:06,500\nRavi: Budget approved\n');
    });
    it('validates stored segments', () => {
        expect(transcriptBody.safeParse({ startedAt: '2026-11-06T10:00:00.000Z', segments: [{ id: 'x', speaker: 'A', language: 'hi', text: 'ok', timestamp: 1 }] }).success).toBe(true);
        expect(transcriptBody.safeParse({ startedAt: 'now', segments: [] }).success).toBe(false);
        expect(transcriptBody.safeParse({ startedAt: '2026-11-06T10:00:00.000Z', segments: [{ id: 'x', speaker: 'A', language: '../', text: 'ok', timestamp: 1 }] }).success).toBe(false);
    });
});
