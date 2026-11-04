import { expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { profileHandler } from './profile.js';
import { InvalidSessionError } from './sessions.js';

function response() {
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    return res;
}
it('keeps infrastructure failures distinct from invalid credentials in the profile route', async () => {
    const verify = vi.fn().mockResolvedValue({ sub: 'user' });
    const query = vi.fn().mockRejectedValue(new Error('database unavailable'));
    const req = { headers: { authorization: 'Bearer valid' } } as Request;
    const res = response();
    await profileHandler(verify, { query })(req, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(503);
    verify.mockRejectedValue(new InvalidSessionError('revoked'));
    const invalid = response();
    await profileHandler(verify, { query })(req, invalid as unknown as Response);
    expect(invalid.status).toHaveBeenCalledWith(401);
});
it('returns the existing profile contract without exposing the session identifier', async () => {
    const res = response();
    await profileHandler(async () => ({ sub: 'user' }), { query: vi.fn().mockResolvedValue({ rows: [{ id: 'user', preferences: { _authSessionId: 'secret', language: 'ja' } }] }) })({ headers: { authorization: 'Bearer valid' } } as Request, res as unknown as Response);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 'user', preferences: { language: 'ja' } }));
});
