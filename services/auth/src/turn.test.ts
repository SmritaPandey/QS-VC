import { afterEach, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { turnCredentials } from './turn.js';
import { serviceSecret } from '../../../shared/service-secrets.cjs';
import type { Request, Response } from 'express';
const subject = 'synthetic-peer';
afterEach(() => vi.unstubAllEnvs());
function response() {
    return { code: 200, body: undefined as any, setHeader: vi.fn(), status(code: number) {this.code = code; return this;},
        sendStatus(code: number) {this.code = code; return this;}, json(body: unknown) {this.body = body; return this;} };
}
it('never issues credentials to an unsigned caller', async () => {
    const res = response();
    await turnCredentials(vi.fn())({ headers: {} } as Request, res as unknown as Response);
    expect(res.code).toBe(401);
    expect(res.body).not.toHaveProperty('iceServers');
});
it('rejects weak or development TURN secrets in production even for a valid account', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TURN_SERVERS', 'turns:relay.test:5349');
    for (const value of ['short-secret', 'dev-turn-secret-change-in-production']) {
        vi.stubEnv('TURN_SECRET', value);
        const res = response();
        await turnCredentials(async () => ({ sub: subject }))({ headers: { authorization: 'Bearer verified-session' } } as Request, res as unknown as Response);
        expect(res.code).toBe(503);
        expect(res.body).not.toHaveProperty('iceServers');
    }
});
it('accepts only a scoped, unexpired signaling capability for guests', async () => {
    vi.stubEnv('TURN_SECRET', 'synthetic-server-secret'); vi.stubEnv('TURN_SERVERS', 'turns:relay.test:5349');
    vi.stubEnv('NODE_ENV', 'test');
    const issue = (options: jwt.SignOptions = {}) => jwt.sign({ meeting: 'synthetic-meeting' }, serviceSecret('TURN_ACCESS_SECRET'),
        { audience: 'qsvc-turn', issuer: 'qsvc-signaling', expiresIn: 30, subject, ...options });
    for (const token of [issue({ audience: 'other' }), issue({ expiresIn: -30 }), jwt.sign({meeting: 'test'}, 'wrong-secret')]) {
        const res = response(); await turnCredentials(vi.fn())({ headers: {'x-qsvc-turn-access':token} } as unknown as Request, res as unknown as Response);
        expect(res.code).toBe(401);
    }
    const res = response(); await turnCredentials(vi.fn())({ headers:{'x-qsvc-turn-access':issue()} } as unknown as Request,res as unknown as Response);
    expect(res.body.iceServers[0].urls).toEqual(['turns:relay.test:5349']);
    expect(JSON.stringify(res.body)).not.toContain('synthetic-server-secret');
    expect(res.body.iceServers[0].username).not.toContain(subject);
});
