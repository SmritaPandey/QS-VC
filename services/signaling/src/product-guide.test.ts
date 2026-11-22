import type { Request, Response } from 'express';
import { expect, it, vi } from 'vitest';
import * as provider from './openrouter.js';
import { productGuideRouter } from './product-guide.js';

it('returns built-in guidance on provider throttling and resumes after the cooldown', async () => {
    vi.useFakeTimers();
    try {
        vi.spyOn(provider, 'openRouterConfigured').mockReturnValue(true);
        const ask = vi.spyOn(provider, 'askOpenRouter')
            .mockRejectedValueOnce(new provider.OpenRouterRateLimitError())
            .mockResolvedValue('Detailed answer');
        const handle = productGuideRouter().stack[0].route!.stack.at(-1)!.handle;
        const req = { body: { question: 'Which controls are available?' } } as Request;
        const json = vi.fn();
        const res = { json, setHeader: vi.fn() } as unknown as Response;
        await handle(req, res, vi.fn());
        await handle(req, res, vi.fn());
        expect(json.mock.calls.map(([body]) => body.source)).toEqual(['local', 'local']);
        expect(ask).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(60_001);
        await handle(req, res, vi.fn());
        expect(json).toHaveBeenLastCalledWith({ answer: 'Detailed answer' });
    } finally {
        vi.restoreAllMocks();
        vi.useRealTimers();
    }
});

it('serves simultaneous identical questions with a single provider call', async () => {
    try {
        vi.spyOn(provider, 'openRouterConfigured').mockReturnValue(true);
        const ask = vi.spyOn(provider, 'askOpenRouter').mockResolvedValue('Use the meeting code.');
        const handle = productGuideRouter().stack[0].route!.stack.at(-1)!.handle;
        const req = { body: { question: 'How do I join?' } } as Request;
        const json = vi.fn();
        const res = { json, setHeader: vi.fn() } as unknown as Response;
        await Promise.all(Array.from({ length: 6 }, () => handle(req, res, vi.fn())));
        expect(ask).toHaveBeenCalledTimes(1);
        expect(json).toHaveBeenCalledTimes(6);
        expect(json).toHaveBeenLastCalledWith({ answer: 'Use the meeting code.' });
    } finally { vi.restoreAllMocks(); }
});
