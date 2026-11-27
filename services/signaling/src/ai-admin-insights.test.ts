import express, { type Request, type Response } from 'express';
import { once } from 'node:events';
import { requirePlatformAdmin } from './admin-controls.js';
import { afterEach, expect, it, vi } from 'vitest';
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

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it.each([
    [401, 'provider_access'], [402, 'provider_credits'], [404, 'provider_routing'], [503, 'provider_unavailable'],
])('returns a truthful local snapshot for OpenRouter HTTP %i', async (status, reason) => {
    vi.stubEnv('OPENROUTER_MODEL_ADMIN_INSIGHTS', 'approved/model');
    vi.spyOn(provider, 'openRouterConfigured').mockReturnValue(true);
    const ask = vi.spyOn(provider, 'askOpenRouter').mockRejectedValue(new provider.OpenRouterResponseError(status));
    const route = adminInsightsRouter((_req, _res, next) => next()).stack[0].route!.stack.at(-1)!.handle;
    const stats = { activeUsers: 13, activeMeetingRecords: 2, scheduledMeetings: 5, endedMeetings: 42 };
    const req = { body: { stats } } as Request;
    const reply = vi.fn();
    const res = { setHeader: vi.fn(), json: reply } as unknown as Response;
    await route(req, res, vi.fn());
    await route(req, res, vi.fn());
    expect(ask).toHaveBeenCalledExactlyOnceWith(expect.any(String), expect.stringContaining(JSON.stringify(stats)), 'approved/model');
    expect(reply).toHaveBeenLastCalledWith(expect.objectContaining({
        source: 'local', reason, insights: expect.stringContaining('Of 49 meeting records'),
    }));
});

it('works without a provider credential and still rejects malformed telemetry', async () => {
    vi.stubEnv('QSVC_DEPLOYMENT', 'online');
    vi.spyOn(provider, 'openRouterConfigured').mockReturnValue(false);
    const ask = vi.spyOn(provider, 'askOpenRouter');
    const route = adminInsightsRouter((_req, _res, next) => next()).stack[0].route!.stack.at(-1)!.handle;
    const res = { setHeader: vi.fn(), json: vi.fn(), status: vi.fn().mockReturnThis() } as unknown as Response;
    await route({ body: { stats: {} } } as Request, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    await route({ body: { stats: { activeUsers: 13, activeMeetingRecords: 2, scheduledMeetings: 5, endedMeetings: 42 } } } as Request, res, vi.fn());
    expect(res.json).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'local', reason: 'not_configured' }));
    expect(ask).not.toHaveBeenCalled();
});


it('serves a labeled result over HTTP only to a verified platform administrator', async () => {
    const fetchLocal = globalThis.fetch;
    const id = { sub: 'test-admin', tenantId: 'test-tenant', role: 'admin' };
    vi.stubGlobal('fetch', vi.fn(async () => globalThis.Response.json({ id: id.sub, tenantId: id.tenantId, role: id.role, isPlatformAdmin: true })));
    vi.spyOn(provider, 'openRouterConfigured').mockReturnValue(true);
    const ask = vi.spyOn(provider, 'askOpenRouter').mockResolvedValue('Verified example analysis');
    const app = express();
    app.use(express.json());
    app.use('/api/admin/ai-insights', adminInsightsRouter(requirePlatformAdmin(async token => ({ ...id, role: token === 'admin' ? 'admin' : 'user' }), 'http://test-auth')));
    const server = app.listen(0, '127.0.0.1');
    try {
        await once(server, 'listening');
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing test server address');
        const send = (token?: string) => fetchLocal(`http://127.0.0.1:${address.port}/api/admin/ai-insights`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ stats: { activeUsers: 1, activeMeetingRecords: 2, scheduledMeetings: 3, endedMeetings: 4 } }),
        });
        expect((await send()).status).toBe(401);
        expect((await send('member')).status).toBe(403);
        expect(ask).not.toHaveBeenCalled();
        const response = await send('admin');
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toMatchObject({ source: 'openrouter', insights: 'Verified example analysis' });
        expect(ask).toHaveBeenCalledOnce();
    } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});
