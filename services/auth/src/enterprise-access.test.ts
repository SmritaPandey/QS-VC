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

it('reports the desktop installers that are actually staged', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'qsvc-enterprise-downloads-'));
    try {
        const arm = path.join(folder, 'arm64.zip');
        const intel = path.join(folder, 'x64.zip');
        const windows = path.join(folder, 'windows-x64.zip');
        const linux = path.join(folder, 'linux-x64.zip');
        writeFileSync(arm, 'apple-silicon-test-artifact');
        writeFileSync(windows, 'windows-installer-archive');
        writeFileSync(linux, 'linux-desktop-archive');
        vi.stubEnv('ENTERPRISE_WINDOWS_INSTALLER', windows);
        vi.stubEnv('ENTERPRISE_MACOS_ARM64_INSTALLER', arm);
        vi.stubEnv('ENTERPRISE_MACOS_X64_INSTALLER', intel);
        vi.stubEnv('ENTERPRISE_LINUX_X64_INSTALLER', linux);
        const router = enterpriseRouter(async () => ({}));
        const route = router.stack.find(layer => layer.route?.path === '/')!.route!;
        const res = { locals: {}, json: vi.fn() };
        await route.stack[0].handle({} as Request, res as unknown as Response, vi.fn());
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            downloads: { windows: true, macAppleSilicon: true, macIntel: false, linuxX64: true },
            windowsAvailable: true,
        }));
    } finally {
        rmSync(folder, { recursive: true, force: true });
    }
});

it.each([
    ['/macos/arm64', 'ENTERPRISE_MACOS_ARM64_INSTALLER', 'arm64.zip', 'QS-VC-macOS-arm64.zip'],
    ['/macos/x64', 'ENTERPRISE_MACOS_X64_INSTALLER', 'intel.zip', 'QS-VC-macOS-x64.zip'],
    ['/linux/x64', 'ENTERPRISE_LINUX_X64_INSTALLER', 'linux.zip', 'QS-VC-Linux-x64.zip'],
    ['/windows', 'ENTERPRISE_WINDOWS_INSTALLER', 'windows.zip', 'QS-VC-Windows-x64.zip'],
] as const)('sends %s as a named ZIP archive', async (routePath, envName, archiveName, downloadName) => {
    const folder = mkdtempSync(path.join(tmpdir(), 'qsvc-macos-zip-'));
    try {
        const archive = path.join(folder, archiveName);
        writeFileSync(archive, 'test-zip-artifact');
        vi.stubEnv(envName, archive);
        const router = enterpriseRouter(async () => ({}));
        const route = router.stack.find(layer => layer.route?.path === routePath)!.route!;
        const res = { download: vi.fn((_file: string, _name: string, done: (error?: Error) => void) => done()) };
        await route.stack[0].handle({} as Request, res as unknown as Response, vi.fn());
        expect(res.download).toHaveBeenCalledWith(archive, downloadName, expect.any(Function));
    } finally {
        rmSync(folder, { recursive: true, force: true });
    }
});

it('registers explicit platform routes plus the legacy route', () => {
    const router = enterpriseRouter(async () => ({}));
    const paths = router.stack.filter(layer => layer.route).map(layer => layer.route?.path);
    expect(paths).toEqual(expect.arrayContaining([
        '/windows', '/macos/arm64', '/macos/x64', '/linux/x64', '/download/:platform',
    ]));
});

it('records only aggregate desktop activation fields for an approved enterprise session', async () => {
    vi.stubEnv('ENTERPRISE_ACCESS_JSON', JSON.stringify([{
        tenantId: 'org', userIds: ['approved'], workspaceUrl: 'https://office.example/',
    }]));
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const router = enterpriseRouter(async () => ({ sub: 'approved', tenantId: 'org' }), { query });
    const guard = router.stack.find(layer => !layer.route)!.handle;
    const activationRoute = router.stack.find(layer => layer.route?.path === '/activation')!.route!;
    const res = { locals: {}, setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await guard({ headers: { authorization: 'Bearer test' } } as Request, res as unknown as Response, next);
    expect(next).toHaveBeenCalledOnce();
    await activationRoute.stack[0].handle({ body: { platform: 'darwin', architecture: 'arm64', appVersion: '1.2.3' } } as Request, res as unknown as Response, vi.fn());
    expect(query).toHaveBeenCalledWith('SELECT public.qsvc_record_desktop_activation($1, $2, $3)', ['darwin', 'arm64', '1.2.3']);
    expect(res.status).toHaveBeenCalledWith(202);
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

it('lets a signed-in user submit an Enterprise request into pending state', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ status: 'enterprise_pending' }] });
    const router = enterpriseRouter(async () => ({ sub: 'requester', tenantId: 'tenant-id' }), { query });
    const route = router.stack.find(layer => layer.route?.path === '/approval-request')!.route!;
    const res = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn(), sendStatus: vi.fn() };
    await route.stack[0].handle({ headers: { authorization: 'Bearer test' } } as Request, res as unknown as Response, vi.fn());
    expect(query).toHaveBeenCalledWith(expect.stringContaining("enterprise_status = 'enterprise_pending'"), ['requester', 'tenant-id']);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ status: 'enterprise_pending' });
});

it('restricts the approval queue to admins and emails the user after an approval decision', async () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const query = vi.fn()
        .mockResolvedValueOnce({ rows: [{ userId, email: 'person@example.test', displayName: 'Person', requestedAt: '2026-11-04T00:00:00Z' }] })
        .mockResolvedValueOnce({ rows: [{ email: 'person@example.test', status: 'enterprise_approved' }] });
    const notify = vi.fn().mockResolvedValue(true);
    const router = enterpriseRouter(async () => ({ sub: 'admin-id', role: 'admin', tenantId: 'tenant-id' }), { query }, notify);
    const queue = router.stack.find(layer => layer.route?.path === '/approval-requests')!.route!;
    const decision = router.stack.find(layer => layer.route?.path === '/approval-requests/:userId')!.route!;
    const res = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn(), sendStatus: vi.fn() };

    await queue.stack[0].handle({ headers: { authorization: 'Bearer test' } } as Request, res as unknown as Response, vi.fn());
    expect(res.json).toHaveBeenCalledWith({ requests: expect.arrayContaining([expect.objectContaining({ userId, email: 'person@example.test' })]) });
    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('tenant_id = $1'), ['tenant-id']);
    await decision.stack[0].handle({ headers: { authorization: 'Bearer test' }, params: { userId }, body: { status: 'enterprise_approved' } } as unknown as Request, res as unknown as Response, vi.fn());
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining("enterprise_status = 'enterprise_pending'"), [userId, 'enterprise_approved', 'admin-id', 'tenant-id']);
    expect(notify).toHaveBeenCalledWith('person@example.test', 'enterprise_approved');
    expect(res.json).toHaveBeenLastCalledWith({ status: 'enterprise_approved', notificationSent: true });
});

it('rejects non-admins from the Enterprise approval queue without reading it', async () => {
    const query = vi.fn();
    const router = enterpriseRouter(async () => ({ sub: 'member-id', role: 'member', tenantId: 'tenant-id' }), { query });
    const route = router.stack.find(layer => layer.route?.path === '/approval-requests')!.route!;
    const res = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn(), sendStatus: vi.fn() };
    await route.stack[0].handle({ headers: { authorization: 'Bearer test' } } as Request, res as unknown as Response, vi.fn());
    expect(res.sendStatus).toHaveBeenCalledWith(403);
    expect(query).not.toHaveBeenCalled();
});
