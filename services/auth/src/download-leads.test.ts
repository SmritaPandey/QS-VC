import { describe, expect, it, vi } from 'vitest';
import { Router, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import { saveDownloadLead, listDownloadLeads, registerDownloadLeadRoutes, downloadLeadRequestError } from './download-leads';
import { InvalidSessionError } from './sessions';
const lead = { name: ' Visitor ', email: ' Visitor@Example.test ', platform: 'linux-installer', consent: true };
function response() {
    return { status: vi.fn().mockReturnThis(), json: vi.fn(), sendStatus: vi.fn(), setHeader: vi.fn() };
}
function database(query = vi.fn().mockResolvedValue({ rows: [{ id: 'saved' }] })) { return { query } as unknown as Pick<Pool, 'query'>; }

describe('download sales leads', () => {
    it('saves only explicit contact permission through a parameterized insert before acknowledging', async () => {
        const query = vi.fn().mockResolvedValue({ rows: [{ id: 'saved' }] }); const res = response();
        await saveDownloadLead(database(query))({ body: lead } as Request, res as unknown as Response);
        expect(res.status).toHaveBeenCalledWith(201);
        const id = res.json.mock.calls[0][0].id;
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
        expect(query.mock.calls[0][1]).toEqual([id, 'Visitor', 'visitor@example.test', 'linux-installer']);
        expect(query.mock.calls[0][0]).toContain('VALUES ($1, $2, $3, $4, true)');
        expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });
    it.each([
        null, { ...lead, name: ' ' }, { ...lead, name: 'x'.repeat(101) },
        { ...lead, email: 'invalid' }, { ...lead, email: 'x'.repeat(256) + '@example.test' },
        { ...lead, consent: false }, { ...lead, consent: undefined }, { ...lead, platform: 'admin' },
    ])('rejects invalid or unconsented data without a write', async body => {
        const query = vi.fn(); const res = response();
        await saveDownloadLead(database(query))({ body } as Request, res as unknown as Response);
        expect(query).not.toHaveBeenCalled(); expect(res.status).toHaveBeenCalledWith(400);
    });
    it.each([vi.fn().mockRejectedValue(new Error('private data')), vi.fn().mockResolvedValue({ rows: [] })])('reports save failure without leaking data', async query => {
        const res = response();
        await saveDownloadLead(database(query))({ body: lead } as Request, res as unknown as Response);
        expect(res.status).toHaveBeenCalledWith(503);
        expect(JSON.stringify(res.json.mock.calls)).not.toContain('private data');
    });
    it.each([
        [undefined, { email: 'services@madylabs.xyz' }, 401],
        ['Bearer token', { email: 'member@example.test', role: 'admin' }, 403],
        ['Bearer token', {}, 403],
        ['Bearer token', new InvalidSessionError('expired'), 401],
    ])('restricts the cross-organisation lead list', async (authorization, identity, status) => {
        const query = vi.fn(); const res = response();
        const verify = vi.fn(async () => { if (identity instanceof Error) throw identity; return identity; });
        await listDownloadLeads(verify, database(query))({ headers: { authorization }, query: {} } as unknown as Request, res as unknown as Response);
        expect(res.sendStatus).toHaveBeenCalledWith(status); expect(query).not.toHaveBeenCalled();
    });
    it('returns a bounded newest-first page with a cursor and no public caching', async () => {
        const rows = Array.from({ length: 101 }, (_, n) => ({ id: `lead-${n}`, name: 'Visitor' }));
        const query = vi.fn().mockResolvedValue({ rows }); const res = response();
        await listDownloadLeads(async () => ({ email: 'services@madylabs.xyz' }), database(query))({ headers: { authorization: 'Bearer token' }, query: {} } as unknown as Request, res as unknown as Response);
        expect(res.json).toHaveBeenCalledWith({ leads: rows.slice(0, 100), nextCursor: 'lead-99' });
        expect(query.mock.calls[0][0]).toContain('ORDER BY created_at DESC, id DESC LIMIT 101');
        expect(query.mock.calls[0][1]).toEqual([null]);
        expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });
    it('validates cursor and parameterizes the next page', async () => {
        const query = vi.fn().mockResolvedValue({ rows: [] }); const res = response();
        const handler = listDownloadLeads(async () => ({ email: 'services@madylabs.xyz' }), database(query));
        await handler({ headers: { authorization: 'Bearer token' }, query: { cursor: 'invalid' } } as unknown as Request, res as unknown as Response);
        expect(res.status).toHaveBeenCalledWith(400); expect(query).not.toHaveBeenCalled();
        const cursor = 'ddeb27fb-d9a0-4624-be4d-4615062daed4';
        await handler({ headers: { authorization: 'Bearer token' }, query: { cursor } } as unknown as Request, res as unknown as Response);
        expect(query.mock.calls[0][1]).toEqual([cursor]); expect(res.json).toHaveBeenCalledWith({ leads: [], nextCursor: null });
    });
    it('reports unavailable lead listing without leaking database errors', async () => {
        const query = vi.fn().mockRejectedValue(new Error('private database details')); const res = response();
        await listDownloadLeads(async () => ({ email: 'services@madylabs.xyz' }), database(query))({ headers: { authorization: 'Bearer token' }, query: {} } as unknown as Request, res as unknown as Response);
        expect(res.status).toHaveBeenCalledWith(503); expect(JSON.stringify(res.json.mock.calls)).not.toContain('private');
    });
    it('rate limits the sixth public submission before writes', async () => {
        const router = Router(); registerDownloadLeadRoutes(router, async () => ({}), database());
        const route = router.stack.find(layer => layer.route?.path === '/download-leads')!.route!;
        const middleware = route.stack[0].handle;
        const req = { ip: '192.0.2.18', headers: {}, socket: { remoteAddress: '192.0.2.18' }, app: { get: () => false } } as unknown as Request;
        const res = { ...response(), getHeader: vi.fn(), on: vi.fn(), send: vi.fn() }; const next = vi.fn();
        for (let i = 0; i < 6; i++) await middleware(req, res as unknown as Response, next);
        expect(next).toHaveBeenCalledTimes(5); expect(res.status).toHaveBeenCalledWith(429);
    });
    it('keeps parser errors and submitted contact details out of shared logging', () => {
        const res = response(); const next = vi.fn(); const error = { status: 400, body: 'private data' };
        downloadLeadRequestError(error, { path: '/API/AUTH/ENTERPRISE/DOWNLOAD-LEADS/' } as Request, res as unknown as Response, next);
        expect(next).not.toHaveBeenCalled(); expect(res.status).toHaveBeenCalledWith(400);
        expect(JSON.stringify(res.json.mock.calls)).not.toContain('private data');
        downloadLeadRequestError(error, { path: '/api/auth/login' } as Request, res as unknown as Response, next);
        expect(next).toHaveBeenCalledWith(error);
    });
});
