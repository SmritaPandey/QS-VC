import { afterEach, describe, it, expect, vi } from 'vitest';
import { createSession, validateSession, requireEnterpriseTerm, endSession } from './sessions';

afterEach(() => vi.unstubAllEnvs());

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

    it('does not require an enterprise term for a platform admin session', async () => {
        vi.stubEnv('QSVC_ENTERPRISE_TERMS_REQUIRED', 'yes');
        const query = vi.fn().mockResolvedValue({ rows: [{ id: 'user', email: 'contact@neurqai.com' }] });
        await expect(validateSession({ query }, { sub: 'user', tenantId: 'tenant', sessionId: 'session' })).resolves.toBeUndefined();
        expect(query).toHaveBeenCalledTimes(1);
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

it('requires an active term only in the restricted workspace mode', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    try {
        vi.stubEnv('QSVC_ENTERPRISE_TERMS_REQUIRED', '');
        await expect(requireEnterpriseTerm({ query }, 'customer')).resolves.toBeUndefined();
        expect(query).not.toHaveBeenCalled();
        vi.stubEnv('QSVC_ENTERPRISE_TERMS_REQUIRED', 'yes');
        await expect(requireEnterpriseTerm({ query }, 'customer')).rejects.toThrow('missing or expired');
        expect(query).toHaveBeenCalledWith(expect.stringContaining('expires_at > now()'), ['customer']);
        query.mockResolvedValue({ rows: [{ '?column?': 1 }] });
        await expect(requireEnterpriseTerm({ query }, 'customer')).resolves.toBeUndefined();
    } finally {
        vi.unstubAllEnvs();
    }
});
