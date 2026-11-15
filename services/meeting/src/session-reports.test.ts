import { afterEach, expect, it, vi } from 'vitest';
import type { Express, Request, Response, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { meetingAuth } from './auth.js';
import { registerSessionReportRoutes } from './session-reports.js';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const tenantId = '11111111-1111-4111-8111-111111111111';
const body = { sessionId: '22222222-2222-4222-8222-222222222222', startedAt: new Date(0).toISOString(), incomplete: false,
    participant: { peerId: 'peer', displayName: 'Owner', joinedAt: new Date(0).toISOString(), leftAt: null, durationMs: 5000,
        estimatedSpeakingMs: 3000, samples: 2, latest: null, lastSampleAt: null, qualityWindow: [], issues: { poorQualitySamples: 0, metricsUnavailableSamples: 0 }, version: 3 } };
function setup() {
    vi.stubEnv('MEETING_POLICY_SECRET', 'test-meeting-policy-secret-long-enough');
    vi.stubEnv('INTERNAL_AUTH_SECRET', 'test-internal-auth-secret-long-enough');
    const routes = new Map<string, RequestHandler[]>();
    const app = { post: (path: string, ...handlers: RequestHandler[]) => routes.set(`POST ${path}`, handlers), get: (path: string, ...handlers: RequestHandler[]) => routes.set(`GET ${path}`, handlers) } as unknown as Express;
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'meeting', host_id: 'owner', tenant_id: tenantId }] });
    const runWithTenant = vi.fn(async (_tenant: string, fn: () => unknown) => fn());
    const rawQuery = vi.fn().mockResolvedValue({ rows: [{ tenant_id: tenantId }] });
    registerSessionReportRoutes(app, { query, runWithTenant } as any, { query: rawQuery } as any, meetingAuth('http://auth', runWithTenant));
    const res = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn() }; res.status.mockReturnValue(res);
    const req = { headers: {}, params: { code: 'report' }, query: {}, body } as unknown as Request;
    async function call(method: 'GET' | 'POST') {
        const handlers = routes.get(method === 'POST' ? 'POST /api/internal/meetings/:code/session-report' : 'GET /api/meetings/code/:code/session-reports')!;
        const dispatch = async (index: number): Promise<unknown> => handlers[index]?.(req, res as unknown as Response, () => dispatch(index + 1));
        await dispatch(0);
        // meetingAuth establishes the request context synchronously via next().
        await vi.waitFor(() => expect(res.json).toHaveBeenCalled());
    }
    return { req, res, query, rawQuery, runWithTenant, call };
}
function authenticate(sub = 'owner', role = 'member') {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ valid: true, payload: { sub, role, tenantId } }) }));
}

it('rejects missing and wrongly scoped service JWTs before touching storage', async () => {
    const ctx = setup();
    await ctx.call('POST');
    expect(ctx.res.status).toHaveBeenCalledWith(401);
    ctx.req.headers.authorization = `Bearer ${jwt.sign({}, process.env.MEETING_POLICY_SECRET!, { audience: 'wrong', issuer: 'qsvc-internal', expiresIn: 30 })}`;
    await ctx.call('POST');
    expect(ctx.rawQuery).not.toHaveBeenCalled();
    expect(ctx.query).not.toHaveBeenCalled();
});

it('persists a valid service report in the resolved tenant with version-guarded updates', async () => {
    const ctx = setup();
    ctx.req.headers.authorization = `Bearer ${jwt.sign({}, process.env.MEETING_POLICY_SECRET!, { audience: 'qsvc-meeting-policy', issuer: 'qsvc-internal', expiresIn: 30 })}`;
    await ctx.call('POST');
    expect(ctx.res.status).toHaveBeenCalledWith(201);
    expect(ctx.runWithTenant).toHaveBeenCalledWith(tenantId, expect.any(Function));
    expect(ctx.rawQuery).toHaveBeenCalledWith(expect.any(String), ['REPORT']);
    expect(ctx.query).toHaveBeenCalledWith(expect.stringContaining('vc_session_reports.version < EXCLUDED.version'), [tenantId, 'meeting', body.sessionId, 'peer', body.startedAt, 3, false, JSON.stringify(body.participant)]);
});

it('requires a verified session to read reports', async () => {
    const ctx = setup();
    await ctx.call('GET');
    expect(ctx.res.status).toHaveBeenCalledWith(401);
    expect(ctx.query).not.toHaveBeenCalled();
});

it.each([['other', 'member', 403], ['owner', 'member', 200], ['admin-user', 'admin', 200]])('checks report reader %s with role %s', async (sub, role, status) => {
    const ctx = setup(); authenticate(sub, role);
    ctx.req.headers.authorization = 'Bearer verified';
    ctx.query.mockResolvedValueOnce({ rows: [{ id: 'meeting', host_id: 'owner' }] }).mockResolvedValueOnce({ rows: [] });
    await ctx.call('GET');
    expect(ctx.query).toHaveBeenNthCalledWith(1, expect.any(String), ['REPORT', tenantId]);
    expect(ctx.runWithTenant).toHaveBeenCalledWith(tenantId, expect.any(Function));
    if (status === 403) {
        expect(ctx.res.status).toHaveBeenCalledWith(403);
        expect(ctx.query).toHaveBeenCalledTimes(1);
    } else expect(ctx.res.json).toHaveBeenCalledWith(expect.objectContaining({ reports: [], retentionDays: 90 }));
});

it('hides meetings outside the verified tenant and sanitizes database failures', async () => {
    const ctx = setup(); authenticate(); ctx.req.headers.authorization = 'Bearer verified';
    ctx.query.mockResolvedValueOnce({ rows: [] });
    await ctx.call('GET');
    expect(ctx.res.status).toHaveBeenCalledWith(404);
    ctx.query.mockRejectedValueOnce(new Error('private connection details'));
    await ctx.call('GET');
    expect(ctx.res.status).toHaveBeenCalledWith(503);
    expect(ctx.res.json).toHaveBeenLastCalledWith({ error: 'Session reports unavailable' });
});

it('validates report pagination before querying', async () => {
    const ctx = setup(); authenticate(); ctx.req.headers.authorization = 'Bearer verified';
    ctx.req.query = { limit: '101' };
    await ctx.call('GET');
    expect(ctx.res.status).toHaveBeenCalledWith(400);
    expect(ctx.query).not.toHaveBeenCalled();
});
