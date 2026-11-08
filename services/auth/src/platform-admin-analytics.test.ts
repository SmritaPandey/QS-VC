import type { Request, Response } from 'express';
import { afterEach, expect, it, vi } from 'vitest';
import { platformAdminAnalyticsRouter } from './platform-admin-analytics';

afterEach(() => vi.unstubAllEnvs());

function makeResponse() {
    return {
        setHeader: vi.fn(),
        sendStatus: vi.fn().mockReturnThis(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
    };
}

function route(router: ReturnType<typeof platformAdminAnalyticsRouter>, path: string, method: 'get' | 'post') {
    const layer = router.stack.find(item => item.route?.path === path);
    if (!layer?.route) throw new Error(`Missing ${method.toUpperCase()} ${path}`);
    return layer.route.stack[0].handle;
}

it('blocks non-admin analytics requests before reading global data', async () => {
    vi.stubEnv('QSVC_ADMIN_EMAILS', 'operator@example.test');
    const query = vi.fn();
    const router = platformAdminAnalyticsRouter(async () => ({ email: 'customer@example.test', role: 'admin' }), { query });
    const res = makeResponse();
    await route(router, '/analytics', 'get')({ headers: { authorization: 'Bearer token' }, query: {} } as unknown as Request, res as unknown as Response, vi.fn());
    expect(res.sendStatus).toHaveBeenCalledWith(403);
    expect(query).not.toHaveBeenCalled();
});

it('requires a signed-in platform admin before any analytics query', async () => {
    const query = vi.fn();
    const invalidToken = new Error('invalid token');
    invalidToken.name = 'JsonWebTokenError';
    const router = platformAdminAnalyticsRouter(async () => { throw invalidToken; }, { query });
    const missing = makeResponse();
    await route(router, '/analytics', 'get')({ headers: {}, query: {} } as unknown as Request, missing as unknown as Response, vi.fn());
    expect(missing.sendStatus).toHaveBeenCalledWith(401);
    const invalid = makeResponse();
    await route(router, '/analytics', 'get')({ headers: { authorization: 'Bearer invalid' }, query: {} } as unknown as Request, invalid as unknown as Response, vi.fn());
    expect(invalid.status).toHaveBeenCalledWith(401);
    expect(invalid.json).toHaveBeenCalledWith({ error: 'Invalid session' });
    expect(query).not.toHaveBeenCalled();
});

it('returns shared analytics through the protected aggregate function', async () => {
    vi.stubEnv('QSVC_ADMIN_EMAILS', 'operator@example.test');
    const result = { totals: { meetingsCreated: 7 }, quarters: [] };
    const query = vi.fn().mockResolvedValue({ rows: [{ analytics: result }] });
    const router = platformAdminAnalyticsRouter(async () => ({ email: 'operator@example.test' }), { query });
    const res = makeResponse();
    await route(router, '/analytics', 'get')({ headers: { authorization: 'Bearer token' }, query: { quarters: '8' } } as unknown as Request, res as unknown as Response, vi.fn());
    expect(query).toHaveBeenCalledWith('SELECT public.qsvc_platform_admin_analytics($1) AS analytics', [8]);
    expect(res.json).toHaveBeenCalledWith(result);
});

it('returns mobile, billing, and plan data only through the protected paginated admin directory', async () => {
    vi.stubEnv('QSVC_ADMIN_EMAILS', 'operator@example.test');
    const directory = { totalUsers: 21, total: 1, planCounts: { pro: 3 }, users: [{ email: 'member@example.test', plan: 'pro', phoneNumber: '+919876543210' }] };
    const query = vi.fn().mockResolvedValue({ rows: [{ directory }] });
    const router = platformAdminAnalyticsRouter(async () => ({ email: 'operator@example.test' }), { query });
    const res = makeResponse();
    await route(router, '/users', 'get')({
        headers: { authorization: 'Bearer token' },
        query: { limit: '20', offset: '10', search: 'member', plan: 'pro', role: 'user' },
    } as unknown as Request, res as unknown as Response, vi.fn());
    expect(query).toHaveBeenCalledWith(
        'SELECT public.qsvc_platform_admin_user_directory($1, $2, $3, $4, $5) AS directory',
        [20, 10, 'member', 'pro', 'user'],
    );
    expect(res.json).toHaveBeenCalledWith(directory);

    const deniedQuery = vi.fn();
    const deniedRouter = platformAdminAnalyticsRouter(async () => ({ email: 'customer@example.test', role: 'admin' }), { query: deniedQuery });
    const denied = makeResponse();
    await route(deniedRouter, '/users', 'get')({ headers: { authorization: 'Bearer token' }, query: {} } as unknown as Request, denied as unknown as Response, vi.fn());
    expect(denied.sendStatus).toHaveBeenCalledWith(403);
    expect(deniedQuery).not.toHaveBeenCalled();
});

it('accepts Pro trial as an admin-directory plan filter', async () => {
    vi.stubEnv('QSVC_ADMIN_EMAILS', 'operator@example.test');
    const query = vi.fn().mockResolvedValue({ rows: [{ directory: { totalUsers: 1, total: 1, planCounts: { pro_trial: 1 }, users: [] } }] });
    const router = platformAdminAnalyticsRouter(async () => ({ email: 'operator@example.test' }), { query });
    const res = makeResponse();
    await route(router, '/users', 'get')({
        headers: { authorization: 'Bearer token' },
        query: { plan: 'pro_trial' },
    } as unknown as Request, res as unknown as Response, vi.fn());
    expect(query).toHaveBeenCalledWith(
        'SELECT public.qsvc_platform_admin_user_directory($1, $2, $3, $4, $5) AS directory',
        [50, 0, '', 'pro_trial', null],
    );
});

it('exposes a small protected access check without reading the analytics database', async () => {
    vi.stubEnv('QSVC_ADMIN_EMAILS', 'operator@example.test');
    const query = vi.fn();
    const router = platformAdminAnalyticsRouter(async () => ({ email: 'operator@example.test' }), { query });
    const res = makeResponse();
    await route(router, '/access', 'get')({ headers: { authorization: 'Bearer token' } } as unknown as Request, res as unknown as Response, vi.fn());
    expect(res.json).toHaveBeenCalledWith({ access: 'granted' });
    expect(query).not.toHaveBeenCalled();

    const denied = makeResponse();
    const nonAdminRouter = platformAdminAnalyticsRouter(async () => ({ email: 'customer@example.test' }), { query });
    await route(nonAdminRouter, '/access', 'get')({ headers: { authorization: 'Bearer token' } } as unknown as Request, denied as unknown as Response, vi.fn());
    expect(denied.sendStatus).toHaveBeenCalledWith(403);
});

it('returns a safe unavailable response when the shared database function is not ready', async () => {
    vi.stubEnv('QSVC_ADMIN_EMAILS', 'operator@example.test');
    const router = platformAdminAnalyticsRouter(async () => ({ email: 'operator@example.test' }), {
        query: vi.fn().mockRejectedValue(new Error('migration pending')),
    });
    const res = makeResponse();
    await route(router, '/analytics', 'get')({ headers: { authorization: 'Bearer token' }, query: {} } as unknown as Request, res as unknown as Response, vi.fn());
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: 'Platform analytics are temporarily unavailable.' });
});

it('rejects invalid reporting windows and finance entries without writing', async () => {
    vi.stubEnv('QSVC_ADMIN_EMAILS', 'operator@example.test');
    const query = vi.fn();
    const router = platformAdminAnalyticsRouter(async () => ({ email: 'operator@example.test', sub: '2bf0ee90-7c95-4759-ae95-efbd1b4f1111' }), { query });
    const getRes = makeResponse();
    await route(router, '/analytics', 'get')({ headers: { authorization: 'Bearer token' }, query: { quarters: '99' } } as unknown as Request, getRes as unknown as Response, vi.fn());
    expect(getRes.status).toHaveBeenCalledWith(400);
    const postRes = makeResponse();
    await route(router, '/financial-entries', 'post')({ headers: { authorization: 'Bearer token' }, body: { type: 'revenue', amount: '-5' } } as unknown as Request, postRes as unknown as Response, vi.fn());
    expect(postRes.status).toHaveBeenCalledWith(400);
    expect(query).not.toHaveBeenCalled();
});

it('writes a validated ledger entry with the signed-in platform admin identity', async () => {
    vi.stubEnv('QSVC_ADMIN_EMAILS', 'operator@example.test');
    const adminId = '2bf0ee90-7c95-4759-ae95-efbd1b4f1111';
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'new-entry' }] });
    const router = platformAdminAnalyticsRouter(async () => ({ email: 'operator@example.test', sub: adminId }), { query });
    const res = makeResponse();
    await route(router, '/financial-entries', 'post')({
        headers: { authorization: 'Bearer token' },
        body: { type: 'expense', category: 'Hosting', amount: '1200.00', currency: 'INR', occurredOn: '2026-11-04', description: 'November invoice' },
    } as unknown as Request, res as unknown as Response, vi.fn());
    expect(query).toHaveBeenCalledWith(
        'SELECT public.qsvc_add_platform_financial_entry($1, $2, $3, $4, $5, $6, $7) AS id',
        [adminId, 'expense', 'Hosting', '1200.00', 'INR', '2026-11-04', 'November invoice'],
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: 'new-entry' });
});
