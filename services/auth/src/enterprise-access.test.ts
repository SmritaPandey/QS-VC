import type { Request, Response } from 'express';
import { afterEach, expect, it, vi } from 'vitest';
import { enterpriseRouter } from './enterprise-access';
afterEach(() => vi.unstubAllEnvs());
async function check(user: Record<string, string> | null) {
    const router = enterpriseRouter(async () => { if (!user) throw Error('invalid'); return user; });
    const res = { locals: {}, setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await router.stack[0].handle({ headers: { authorization: 'Bearer test' } } as Request, res as unknown as Response, next);
    return { res, next };
}
it('requires explicit matching tenant and approved user, not merely tenant membership', async () => {
    vi.stubEnv('ENTERPRISE_ACCESS_JSON', JSON.stringify([{ tenantId: 'org', userIds: ['approved'], workspaceUrl: 'https://office.example/app' }]));
    const denied = await check({ sub: 'self-registered', tenantId: 'org' });
    expect(denied.res.status).toHaveBeenCalledWith(403);
    expect(denied.next).not.toHaveBeenCalled();
    expect((await check({ sub: 'approved', tenantId: 'wrong' })).next).not.toHaveBeenCalled();
    expect((await check({ sub: 'approved', tenantId: 'org' })).next).toHaveBeenCalledOnce();
});
it('fails closed for invalid sessions and unsafe workspace configuration', async () => {
    expect((await check(null)).next).not.toHaveBeenCalled();
    vi.stubEnv('ENTERPRISE_ACCESS_JSON', JSON.stringify([{ tenantId: 'org', userIds: ['approved'], workspaceUrl: 'http://office.example' }]));
    expect((await check({ sub: 'approved', tenantId: 'org' })).next).not.toHaveBeenCalled();
});
it('lets platform admins in without a per-user grant, using the admin workspace address', async () => {
    vi.stubEnv('ENTERPRISE_ACCESS_JSON', '[]');
    expect((await check({ sub: 'boss', tenantId: 'any', role: 'admin' })).res.status).toHaveBeenCalledWith(403);
    vi.stubEnv('QSVC_ADMIN_WORKSPACE_URL', 'https://intranet.example/');
    const allowed = await check({ sub: 'boss', tenantId: 'any', role: 'admin' });
    expect(allowed.next).toHaveBeenCalledOnce();
    expect((allowed.res.locals as { workspaceUrl?: string }).workspaceUrl).toBe('https://intranet.example/');
    expect((await check({ sub: 'someone', tenantId: 'any', role: 'member' })).next).not.toHaveBeenCalled();
});
