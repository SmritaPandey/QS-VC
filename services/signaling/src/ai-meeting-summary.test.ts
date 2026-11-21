import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateMeetingSummary } from './ai-meeting-summary.js';
import * as openrouterModule from './openrouter.js';

describe('Meeting Summary Generator', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('generates executive meeting summary from transcripts', async () => {
        vi.spyOn(openrouterModule, 'openRouterConfigured').mockReturnValue(true);
        vi.spyOn(openrouterModule, 'askOpenRouter').mockResolvedValue('## Executive Overview\nDiscussed PQC rollout.');

        const entries = [
            { id: '1', peerId: 'p1', speaker: 'Alice', language: 'en', text: 'Let us deploy ML-KEM-1024 tomorrow.', timestamp: Date.now() },
            { id: '2', peerId: 'p2', speaker: 'Bob', language: 'en', text: 'Agreed, security review is complete.', timestamp: Date.now() + 1000 },
        ];

        const summary = await generateMeetingSummary(entries, {
            meetingCode: 'QS-CONF-123',
            participants: ['Alice', 'Bob'],
            durationMs: 120_000,
            language: 'English',
        });

        expect(summary).toContain('## Executive Overview');
        expect(openrouterModule.askOpenRouter).toHaveBeenCalled();
    });

    it('labels speaker-attributed excerpts when OpenRouter is throttled', async () => {
        vi.spyOn(openrouterModule, 'openRouterConfigured').mockReturnValue(true);
        vi.spyOn(openrouterModule, 'askOpenRouter').mockRejectedValue(new openrouterModule.OpenRouterRateLimitError());
        const result = await generateMeetingSummary([
            { id: '1', peerId: 'p', speaker: 'Asha', language: 'en', text: 'Review the release.', timestamp: 0 },
        ], { meetingCode: 'QS-TEST', participants: [], durationMs: 1000 });
        expect(result).toContain('AI analysis is rate-limited');
        expect(result).toContain('Asha: Review the release.');
    });

    it('rejects when transcript is empty', async () => {
        vi.spyOn(openrouterModule, 'openRouterConfigured').mockReturnValue(true);
        await expect(generateMeetingSummary([], {
            meetingCode: 'QS-EMPTY',
            participants: [],
            durationMs: 0,
        })).rejects.toThrow('No transcript available');
    });
});
