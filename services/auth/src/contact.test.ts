import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { contactHandler, contactRouter, contactRequestError } from './contact';

const enquiry = { name: 'Demo Visitor', email: 'visitor@example.test', organisation: 'Synthetic Team', topic: 'pricing', message: 'I would like to discuss the Starter plan.', website: '' };
function response() { return { status: vi.fn().mockReturnThis(), json: vi.fn() }; }
function request(body: unknown) { return { body } as Request; }

describe('contact enquiry persistence', () => {
    it('returns a receipt only after a parameterized insert succeeds', async () => {
        const query = vi.fn().mockResolvedValue({ rows: [{ id: 'saved' }] }); const res = response();
        await contactHandler({ query })(request(enquiry), res as unknown as Response);
        expect(res.status).toHaveBeenCalledWith(201);
        const { id } = res.json.mock.calls[0][0];
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
        expect(query.mock.calls[0][0]).toContain('VALUES ($1, $2, $3, $4, $5, $6) RETURNING id');
        expect(query.mock.calls[0][1]).toEqual([id, enquiry.name, enquiry.email, enquiry.organisation, enquiry.topic, enquiry.message]);
        expect(res.json.mock.calls[0][0]).toEqual({ id });
    });
    it.each([
        { ...enquiry, name: ' ' }, { ...enquiry, email: 'invalid' },
        { ...enquiry, topic: 'admin' }, { ...enquiry, message: 'x'.repeat(4001) },
        { ...enquiry, message: '' }, { ...enquiry, website: 'bot.example.test' },
        { ...enquiry, organisation: 'x'.repeat(201) }, null,
    ])('rejects malformed input and honeypots without writing', async body => {
        const query = vi.fn(); const res = response();
        await contactHandler({ query })(request(body), res as unknown as Response);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(query).not.toHaveBeenCalled();
        expect(res.json.mock.calls[0][0]).not.toHaveProperty('id');
    });
    it('accepts absent optional fields and treats message text as data', async () => {
        const query = vi.fn().mockResolvedValue({ rows: [{}] }); const res = response();
        await contactHandler({ query })(request({ name: ' Visitor ', email: ' visitor@example.test ', topic: 'demo', message: "'); DROP TABLE users; --" }), res as unknown as Response);
        expect(res.status).toHaveBeenCalledWith(201);
        expect(query.mock.calls[0][1].slice(1)).toEqual(['Visitor', 'visitor@example.test', null, 'demo', "'); DROP TABLE users; --"]);
        expect(query.mock.calls[0][0]).not.toContain('DROP TABLE');
    });
    it.each(['failure', 'empty'])('never reports success when the database returns %s', async mode => {
        const query = mode === 'failure' ? vi.fn().mockRejectedValue(new Error('database credentials and visitor@example.test')) : vi.fn().mockResolvedValue({ rows: [] });
        const res = response();
        await contactHandler({ query })(request(enquiry), res as unknown as Response);
        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.json).toHaveBeenCalledWith({ error: 'Your enquiry could not be saved. Please try again later.' });
    });
    it('registers only a POST route with rate limiting before the handler', () => {
        const router = contactRouter({ query: vi.fn() });
        const route = router.stack.find(layer => layer.route)!.route as unknown as { methods: Record<string, boolean>; stack: { handle: (req: Request, res: Response, next: () => void) => unknown }[] };
        expect(route.methods).toEqual({ post: true });
        expect(route.stack).toHaveLength(2);
    });
    it('rate limits the sixth enquiry from an address within the hour', async () => {
        const router = contactRouter({ query: vi.fn() });
        const middleware = router.stack.find(layer => layer.route)!.route!.stack[0].handle;
        const req = { ip: '192.0.2.17', headers: {}, socket: { remoteAddress: '192.0.2.17' }, app: { get: () => false } } as unknown as Request;
        const res = { ...response(), setHeader: vi.fn(), getHeader: vi.fn(), on: vi.fn(), send: vi.fn() };
        const next = vi.fn();
        for (let i = 0; i < 6; i++) await middleware(req, res as unknown as Response, next);
        expect(next).toHaveBeenCalledTimes(5);
        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.send).toHaveBeenCalledWith({ error: 'Too many enquiries. Please try again later.' });
    });

    it.each([
        [{ status: 400, type: 'entity.parse.failed', body: 'private malformed email and message' }, 400],
        [{ status: 413, type: 'entity.too.large', body: 'private oversized enquiry' }, 413],
        [{ status: 500, body: 'private unexpected detail' }, 503],
    ])('handles contact parser errors before logging or forwarding sensitive bodies', (error, status) => {
        const res = response(); const next = vi.fn();
        contactRequestError(error, { path: '/api/auth/contact' } as Request, res as unknown as Response, next);
        expect(res.status).toHaveBeenCalledWith(status);
        expect(next).not.toHaveBeenCalled();
        expect(JSON.stringify(res.json.mock.calls)).not.toContain('private');
    });
    it('protects case-insensitive/trailing-slash contact paths and preserves other routes', () => {
        const error = { status: 400, body: 'private' }; const next = vi.fn(); const res = response();
        contactRequestError(error, { path: '/API/AUTH/CONTACT/' } as Request, res as unknown as Response, next);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(next).not.toHaveBeenCalled();
        contactRequestError(error, { path: '/api/auth/login' } as Request, res as unknown as Response, next);
        expect(next).toHaveBeenCalledWith(error);
    });

});
