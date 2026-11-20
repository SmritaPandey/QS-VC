import { expect, it, vi } from 'vitest';
import { webinarsRouter } from './webinars.js';
const webinarId = '11111111-1111-4111-8111-111111111111';
function setup(rows: unknown[] = [], owns = true) {
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes('FROM public.webinars w') ? owns ? [{ id: webinarId }] : [] : sql.includes('FROM public.webinar_registrations') ? rows : [] }));
    const client = { query, release: vi.fn() };
    const pool = { connect: vi.fn(async () => client) };
    const auth = vi.fn(); const feature = vi.fn();
    const router = webinarsRouter(pool as any, auth, feature);
    const handler = (router as any).stack.find((layer: any) => layer.route?.path === '/:id' && layer.route.methods.get).route.stack[0].handle;
    const res = { status: vi.fn(), json: vi.fn(), sendStatus: vi.fn() }; res.status.mockReturnValue(res);
    const req = { params: { id: webinarId }, query: {}, user: { sub: 'owner', tenantId: 'tenant' } };
    return { query, pool, res, req, call: () => handler(req, res) };
}
it('returns bounded pages, deterministic order, and a next offset beyond the old 1000-row ceiling', async () => {
    const ctx = setup(Array.from({ length: 101 }, (_, id) => ({ id })));
    ctx.req.query = { limit: '100', offset: '1000' };
    await ctx.call();
    expect(ctx.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3'), [webinarId, 101, 1000]);
    expect(ctx.res.json).toHaveBeenCalledWith({ id: webinarId, registrations: Array.from({ length: 100 }, (_, id) => ({ id })), registrationOffset: 1000, nextOffset: 1100 });
    expect(ctx.query).toHaveBeenCalledWith(expect.stringContaining('w.owner_id = $3 AND m.host_id = $3'), [webinarId, 'tenant', 'owner']);
    expect(ctx.query).toHaveBeenCalledWith("SELECT set_config('app.current_tenant', $1, true)", ['tenant']);
});
it('marks the last page and an empty page without inventing another page', async () => {
    const ctx = setup([{ id: 'last' }]); ctx.req.query = { limit: '1', offset: '1200' }; await ctx.call();
    expect(ctx.res.json).toHaveBeenCalledWith({ id: webinarId, registrations: [{ id: 'last' }], registrationOffset: 1200, nextOffset: null });
    const empty = setup(); await empty.call();
    expect(empty.res.json).toHaveBeenCalledWith({ id: webinarId, registrations: [], registrationOffset: 0, nextOffset: null });
});
it.each([{ limit: '101' }, { limit: '0' }, { limit: '1.5' }, { offset: '-1' }, { offset: '100001' }, { offset: 'bad' }, { limit: ['1', '2'] }])('rejects invalid pagination %j before opening a database connection', async query => {
    const ctx = setup(); ctx.req.query = query; await ctx.call();
    expect(ctx.res.status).toHaveBeenCalledWith(400); expect(ctx.pool.connect).not.toHaveBeenCalled();
});
it('does not expose a roster when tenant ownership lookup fails', async () => {
    const ctx = setup([{ id: 'private' }], false); await ctx.call();
    expect(ctx.res.sendStatus).toHaveBeenCalledWith(404);
    expect(ctx.query.mock.calls.some(([sql]) => sql.includes('FROM public.webinar_registrations'))).toBe(false);
});

it.each([false, true])('creates registration only for a room already configured as a webinar (%s)', async isWebinar => {
    const query = vi.fn(async (sql: string, _params?: unknown[]) => ({ rows: sql.includes('SELECT id FROM public.meetings') && isWebinar ? [{ id: webinarId }] : [] }));
    const client = { query, release: vi.fn() };
    const router = webinarsRouter({ connect: vi.fn(async () => client) } as any, vi.fn(), vi.fn());
    const handler = (router as any).stack.find((layer: any) => layer.route?.path === '/' && layer.route.methods.post).route.stack[0].handle;
    const res = { status: vi.fn(), json: vi.fn(), sendStatus: vi.fn() };
    res.status.mockReturnValue(res);
    const user = { sub: 'owner', tenantId: 'tenant' };
    await handler({ params: {}, user, body: {
        meetingId: webinarId, title: 'Live training', description: '', registrationLimit: 100, published: true,
        customFields: [], branding: { logoUrl: '', backgroundUrl: '', introVideoUrl: '', accent: '#006d77' }, speakers: [],
    } }, res);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("settings->>'meetingKind' = 'webinar'"), [webinarId, user.tenantId, user.sub]);
    expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE public.meetings'))).toBe(false);
    if (isWebinar) expect(res.status).toHaveBeenCalledWith(201);
    else {
        expect(res.sendStatus).toHaveBeenCalledWith(404);
        expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO public.webinars'))).toBe(false);
    }
});
