import type { Pool } from 'pg';
import type { Request, Response } from 'express';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { enterpriseRouter } from './enterprise-access';
import { InvalidSessionError } from './sessions';
afterEach(() => vi.unstubAllEnvs());
async function check(user: Record<string, string> | Error, db?: Pick<Pool, 'query'>) {
    const router = enterpriseRouter(async () => { if (user instanceof Error) throw user; return user; }, db);
    const res = { locals: {}, setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await router.stack.find(layer => !layer.route)!.handle({ headers: { authorization: 'Bearer test' } } as Request, res as unknown as Response, next);
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
    const expired = await check(new InvalidSessionError('expired'));
    expect(expired.next).not.toHaveBeenCalled();
    expect(expired.res.status).toHaveBeenCalledWith(401);
    const outage = await check(new Error('database unavailable'));
    expect(outage.next).not.toHaveBeenCalled();
    expect(outage.res.status).toHaveBeenCalledWith(503);
    vi.stubEnv('ENTERPRISE_ACCESS_JSON', JSON.stringify([{ tenantId: 'org', userIds: ['approved'], workspaceUrl: 'http://office.example' }]));
    expect((await check({ sub: 'approved', tenantId: 'org' })).next).not.toHaveBeenCalled();
});
it('lets platform admins in without a per-user grant, using the admin workspace address', async () => {
    vi.stubEnv('ENTERPRISE_ACCESS_JSON', '[]');
    expect((await check({ sub: 'boss', tenantId: 'any', role: 'admin' })).res.status).toHaveBeenCalledWith(403);
    const admin = { sub: 'boss', tenantId: 'any', role: 'admin', email: 'services@madylabs.xyz' };
    const demo = await check(admin);
    expect(demo.next).toHaveBeenCalledOnce();
    expect(demo.res.locals).toMatchObject({ workspaceUrl: 'https://qsvcmeet.com/app', workspaceMode: 'online-demo' });
    vi.stubEnv('QSVC_ADMIN_WORKSPACE_URL', 'https://intranet.example/');
    const allowed = await check(admin);
    expect(allowed.next).toHaveBeenCalledOnce();
    expect(allowed.res.locals).toMatchObject({ workspaceUrl: 'https://intranet.example/', workspaceMode: 'organisation' });
    expect((await check({ sub: 'someone', tenantId: 'any', role: 'member' })).next).not.toHaveBeenCalled();
});

it('reports only the Windows and Mac installers that are actually staged', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'qsvc-enterprise-downloads-'));
    try {
        const arm = path.join(folder, 'arm64.zip');
        const intel = path.join(folder, 'x64.zip');
        writeFileSync(arm, 'apple-silicon-test-artifact');
        vi.stubEnv('ENTERPRISE_WINDOWS_INSTALLER', path.join(folder, 'missing.exe'));
        vi.stubEnv('ENTERPRISE_MACOS_ARM64_INSTALLER', arm);
        vi.stubEnv('ENTERPRISE_MACOS_X64_INSTALLER', intel);
        const router = enterpriseRouter(async () => ({}));
        const route = router.stack.find(layer => layer.route?.path === '/')!.route!;
        const res = { locals: {}, json: vi.fn() };
        await route.stack[0].handle({} as Request, res as unknown as Response, vi.fn());
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            downloads: { windows: false, macAppleSilicon: true, macIntel: false },
            windowsAvailable: false,
        }));
    } finally {
        rmSync(folder, { recursive: true, force: true });
    }
});

it('blocks expired terms even when the user also has a legacy grant', async () => {
    vi.stubEnv('ENTERPRISE_ACCESS_JSON', JSON.stringify([{ tenantId: 'org', userIds: ['approved'], workspaceUrl: 'https://legacy.example/' }]));
    const query = vi.fn().mockResolvedValue({ rows: [{ active: false, workspace_url: 'https://office.example/' }] });
    const result = await check({ sub: 'approved', tenantId: 'org' }, { query });
    expect(result.res.status).toHaveBeenCalledWith(403);
    expect(result.next).not.toHaveBeenCalled();
    query.mockResolvedValue({ rows: [{ active: true, workspace_url: 'https://office.example/', expires_at: '2027-11-04T00:00:00Z' }] });
    expect((await check({ sub: 'approved', tenantId: 'org' }, { query })).res.locals).toMatchObject({
        workspaceUrl: 'https://office.example/', expiresAt: '2027-11-04T00:00:00Z',
    });
});

it('blocks customer lookup before querying the database for a non-platform admin', async () => {
    vi.stubEnv('QSVC_ADMIN_EMAILS', 'operator@example.test');
    const query = vi.fn();
    const router = enterpriseRouter(async () => ({ email: 'customer@example.test', role: 'admin' }), { query });
    const res = { setHeader: vi.fn(), sendStatus: vi.fn() };
    const lookup = router.stack.find(layer => layer.route?.path === '/terms')!.route!.stack[0].handle;
    await lookup({ headers: { authorization: 'Bearer test' }, query: { email: 'target@example.test' } } as unknown as Request, res as unknown as Response, vi.fn());
    expect(res.sendStatus).toHaveBeenCalledWith(403);
    expect(query).not.toHaveBeenCalled();
});
