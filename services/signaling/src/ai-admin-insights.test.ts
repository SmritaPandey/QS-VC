import type { Request, Response } from 'express';
import { expect, it, vi } from 'vitest';
import { adminInsightsRouter } from './ai-admin-insights.js';
import * as provider from './openrouter.js';

it('returns a local snapshot during provider throttling and reuses a recovered answer', async () => {
    vi.useFakeTimers();
    try {
        vi.spyOn(provider, 'openRouterConfigured').mockReturnValue(true);
        const ask = vi.spyOn(provider, 'askOpenRouter')
            .mockRejectedValueOnce(new provider.OpenRouterRateLimitError())
            .mockResolvedValue('Detailed analysis');
        const router = adminInsightsRouter((_req, _res, next) => next());
        const handle = router.stack[0].route!.stack.at(-1)!.handle;
        const stats = { activeUsers: 4, activeMeetingRecords: 1, scheduledMeetings: 2, endedMeetings: 3 };
        const reply = vi.fn();
        const req = { body: { stats } } as Request;
        const res = { setHeader: vi.fn(), json: reply } as unknown as Response;
        await handle(req, res, vi.fn());
        await handle(req, res, vi.fn());
        expect(reply).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'local' }));
        expect(ask).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(60_001);
        await Promise.all([handle(req, res, vi.fn()), handle(req, res, vi.fn())]);
        await handle(req, res, vi.fn());
        expect(reply).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'openrouter', insights: 'Detailed analysis' }));
        expect(ask).toHaveBeenCalledTimes(2);
    } finally {
        vi.restoreAllMocks();
        vi.useRealTimers();
    }
});
