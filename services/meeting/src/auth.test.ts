import { afterEach, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { meetingAuth, requireFeature } from './auth.js';
afterEach(() => vi.unstubAllGlobals());
const req = () => ({ headers: { authorization: 'Bearer valid' } }) as Request;
async function check(reply: unknown, rejected = false) {
    vi.stubGlobal('fetch', rejected ? vi.fn().mockRejectedValue(reply) : vi.fn().mockResolvedValue(reply));
    const res = { status: vi.fn(), json: vi.fn() }; res.status.mockReturnValue(res);
    const next = vi.fn(); const tenant = vi.fn((id, callback) => callback());
    const request = req();
    await meetingAuth('http://auth', tenant)(request, res as unknown as Response, next);
    return { res, next, tenant, request };
}
it.each([503, 429, 500])('returns 503, never 401, when auth responds %s', async status => {
    const { res, next } = await check({ ok: false, status });
    expect(res.status).toHaveBeenCalledWith(503); expect(next).not.toHaveBeenCalled();
});
it('keeps network failure retryable and rejects confirmed invalid credentials', async () => {
    expect((await check(new Error('timeout'), true)).res.status).toHaveBeenCalledWith(503);
    expect((await check({ ok: false, status: 401 })).res.status).toHaveBeenCalledWith(401);
});
it('rejects malformed auth success without running a tenant request', async () => {
    const { res, tenant } = await check({ ok: true, json: async () => ({ valid: true, payload: { sub: 'user' } }) });
    expect(res.status).toHaveBeenCalledWith(503); expect(tenant).not.toHaveBeenCalled();
});
it('runs a valid request inside its verified tenant', async () => {
    const { tenant, next } = await check({ ok: true, json: async () => ({ valid: true, payload: { sub: 'user', tenantId: 'tenant' } }) });
    expect(tenant).toHaveBeenCalledWith('tenant', next); expect(next).toHaveBeenCalledOnce();
});

it('rejects a guest at the API boundary with the configured required plan', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ plan: 'guest', features: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    const req = { headers: {} } as Request;
    const res = { status: vi.fn(), json: vi.fn() }; res.status.mockReturnValue(res);
    const next = vi.fn();
    await requireFeature('http://auth', 'meeting_scheduling')(req, res as unknown as Response, next);
    expect(fetchMock).toHaveBeenCalledWith('http://auth/api/auth/me/entitlements', expect.objectContaining({ headers: {} }));
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ code: 'UPGRADE_REQUIRED', requiredPlan: 'starter', feature: 'meeting_scheduling' });
    expect(next).not.toHaveBeenCalled();
});

it('allows an entitled user and fails closed when entitlement lookup is unavailable', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ features: ['cloud_recording'] }) })
        .mockResolvedValueOnce({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetchMock);
    const req = { headers: { authorization: 'Bearer valid' } } as Request;
    const res = { status: vi.fn(), json: vi.fn() }; res.status.mockReturnValue(res);
    const next = vi.fn();
    await requireFeature('http://auth', 'cloud_recording')(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalledOnce();
    await requireFeature('http://auth', 'cloud_recording')(req, res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledWith(503);
});
