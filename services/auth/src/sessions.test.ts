import { describe, it, expect, vi } from 'vitest';
import { createSession, validateSession, endSession } from './sessions';

describe('persistent account sessions', () => {
    it('stores a fresh unpredictable session and rejects inactive accounts', async () => {
        const query = vi.fn().mockResolvedValue({ rows: [{ id: 'user' }] });
        const sessionId = await createSession({ query }, 'user');
        expect(sessionId).toMatch(/^[a-f0-9-]{36}$/);
        expect(query.mock.calls[0][1]).toEqual(['user', sessionId]);
        expect(query.mock.calls[0][0]).toContain('is_active = true');
        query.mockResolvedValue({ rows: [] });
        await expect(createSession({ query }, 'user')).rejects.toThrow('Inactive account');
    });

    it('rejects legacy, revoked and disabled sessions; binds account and tenant', async () => {
        const query = vi.fn().mockResolvedValue({ rows: [] });
        await expect(validateSession({ query }, { sub: 'user' })).rejects.toThrow('Invalid session');
        expect(query).not.toHaveBeenCalled();
        const payload = { sub: 'user', tenantId: 'tenant', sessionId: 'session' };
        await expect(validateSession({ query }, payload)).rejects.toThrow('Session expired');
        expect(query.mock.calls[0][1]).toEqual(['user', 'tenant', 'session']);
        expect(query.mock.calls[0][0]).toContain('is_active = true');
        query.mockResolvedValue({ rows: [{ id: 'user' }] });
        await expect(validateSession({ query }, payload)).resolves.toBeUndefined();
    });

    it('logout only removes matching session so an old logout cannot revoke a newer login', async () => {
        const query = vi.fn().mockResolvedValue({ rows: [] });
        await endSession({ query }, { sub: 'user', tenantId: 'tenant', sessionId: 'old' });
        expect(query.mock.calls[0][0]).toContain("preferences->>'_authSessionId' = $3");
        expect(query.mock.calls[0][1]).toEqual(['user', 'tenant', 'old']);
    });
});

it('classifies database failures as retryable rather than invalid sessions', async () => {
    const { sessionErrorStatus, InvalidSessionError } = await import('./sessions.js');
    expect(sessionErrorStatus(new Error('database unavailable'))).toBe(503);
    expect(sessionErrorStatus(new InvalidSessionError('revoked'))).toBe(401);
});
