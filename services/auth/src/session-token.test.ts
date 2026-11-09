import { afterEach, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
const claims = { sub: 'test-user', sessionId: 'test-session', tenantId: 'test-tenant' };
it('issues asymmetric sessions and rejects expired, incomplete and legacy symmetric sessions', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const { signSession, verifySessionToken } = await import('./session-token.js');
    const valid = await signSession(claims, 60);
    expect(jwt.decode(valid, { complete: true })?.header.alg).toBe('EdDSA');
    expect(await verifySessionToken(valid)).toMatchObject(claims);
    for (const invalid of [await signSession(claims, -1), await signSession({ sub: claims.sub }, 60),
        jwt.sign(claims, 'legacy-secret'), `${valid.slice(0, -8)}tampered`]) {
        await expect(verifySessionToken(invalid)).rejects.toThrow('Invalid session');
    }
});
it('requires a provisioned signing key outside development and test', async () => {
    vi.stubEnv('NODE_ENV', 'staging');
    vi.stubEnv('SESSION_SIGNING_KEY_FILE', '');
    const { prepareSessionSigning } = await import('./session-token.js');
    await expect(prepareSessionSigning()).rejects.toThrow('SESSION_SIGNING_KEY_FILE');
});
