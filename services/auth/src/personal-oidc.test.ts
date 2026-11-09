import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enabledProviders, exchangePersonalCode, personalIdentity } from './personal-oidc.js';
import type { Pool } from 'pg';
import { assertAvailableEmail, checkPersonalEmail } from './personal-store.js';

const google = 'https://accounts.google.com';
const tenant = '9188040d-6c67-4c5b-b112-36a304b66dad';
const microsoft = `https://login.microsoftonline.com/${tenant}/v2.0`;
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('personal identity policy', () => {
    it('recognises only authoritative Google email addresses', () => {
        const claims = { iss: google, sub: 'abc', email_verified: true };
        expect(personalIdentity('google', { ...claims, email: 'Person@gmail.com' }).verifiedEmail).toBe('person@gmail.com');
        expect(personalIdentity('google', { ...claims, email: 'person@corp.example', hd: 'corp.example' }).verifiedEmail).toBe('person@corp.example');
        expect(personalIdentity('google', { ...claims, email: 'person@other.example' }).verifiedEmail).toBeUndefined();
        expect(personalIdentity('google', { ...claims, email: 'person@gmail.com', email_verified: false }).verifiedEmail).toBeUndefined();
    });

    it('requires the Microsoft consumer tenant and treats its email as a suggestion', () => {
        const claims = { iss: microsoft, tid: tenant, sub: 'abc', email: 'person@outlook.com', email_verified: true };
        expect(personalIdentity('microsoft', claims)).toMatchObject({ email: 'person@outlook.com', verifiedEmail: undefined });
        expect(() => personalIdentity('microsoft', { ...claims, tid: 'another-tenant' })).toThrow();
        expect(personalIdentity('microsoft', claims).subject).not.toBe(personalIdentity('google', { iss: google, sub: 'abc' }).subject);
    });

    it('hides unconfigured providers and protects Enterprise-only workspaces', () => {
        vi.stubEnv('QSVC_GOOGLE_CLIENT_ID', 'google-id');
        vi.stubEnv('QSVC_GOOGLE_CLIENT_SECRET', 'google-secret');
        vi.stubEnv('QSVC_MICROSOFT_CLIENT_ID', 'microsoft-id');
        vi.stubEnv('QSVC_MICROSOFT_CLIENT_SECRET', '');
        vi.stubEnv('QSVC_ENTERPRISE_TERMS_REQUIRED', 'no');
        expect(enabledProviders()).toEqual(['google']);
        vi.stubEnv('QSVC_ENTERPRISE_TERMS_REQUIRED', 'yes');
        expect(enabledProviders()).toEqual([]);
    });

    it('rejects an existing email instead of signing into or replacing its account', async () => {
        vi.stubEnv('QSVC_DEPLOYMENT', 'development');
        const query = vi.fn(async (sql: string) => ({ rows: sql.includes('FROM users') ? [{ id: 'existing-user' }] : [] }));
        const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
        await expect(assertAvailableEmail(pool, 'existing@example.org')).rejects.toThrow('already has an account');
        await expect(checkPersonalEmail(pool, 'services@madylabs.xyz')).rejects.toThrow('existing sign-in method');
    });

    it('blocks personal sign-in on an enforced Enterprise domain', async () => {
        const query = vi.fn(async (sql: string) => ({ rows: sql.includes('FROM sso_connections') ? [{ enforce_sso: true }] : [] }));
        const pool = { connect: async () => ({ query, release() {} }) } as unknown as Pool;
        await expect(checkPersonalEmail(pool, 'employee@example.org')).rejects.toThrow('organisation sign-in');
    });
});

describe.each([
    { provider: 'google' as const, issuer: google },
    { provider: 'microsoft' as const, issuer: microsoft },
])('$provider signed OAuth callback', ({ provider, issuer }) => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const verifier = 'a'.repeat(43);
    const url = new URL('https://app.example/sso/callback?code=one-use&state=expected-state');

    function mockProvider(nonce = 'expected-nonce') {
        const prefix = `QSVC_${provider.toUpperCase()}`;
        vi.stubEnv(`${prefix}_CLIENT_ID`, 'personal-client');
        vi.stubEnv(`${prefix}_CLIENT_SECRET`, 'synthetic-secret');
        let redeemed = false;
        vi.stubGlobal('fetch', async (target: URL, options?: RequestInit) => {
            const endpoint = String(target);
            if (endpoint.endsWith('/.well-known/openid-configuration')) return Response.json({
                issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
                id_token_signing_alg_values_supported: ['RS256'],
            });
            if (endpoint.endsWith('/jwks')) return Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test', alg: 'RS256' }] });
            if (endpoint.endsWith('/token')) {
                const body = new URLSearchParams(String(options?.body));
                if (redeemed || body.get('code_verifier') !== verifier) return Response.json({ error: 'invalid_grant' }, { status: 400 });
                redeemed = true;
                return Response.json({ access_token: 'synthetic', token_type: 'Bearer', id_token: jwt.sign(
                    { sub: 'synthetic-user', tid: tenant, email: 'person@gmail.com', email_verified: true, nonce },
                    privateKey, { issuer, audience: 'personal-client', algorithm: 'RS256', keyid: 'test', expiresIn: 60 },
                ) });
            }
            throw new Error('Unexpected endpoint');
        });
    }

    it('validates state, signature, nonce and one-use code redemption', async () => {
        mockProvider();
        await expect(exchangePersonalCode(provider, url, 'wrong-state', 'expected-nonce', verifier)).rejects.toThrow();
        await expect(exchangePersonalCode(provider, url, 'expected-state', 'expected-nonce', verifier)).resolves.toMatchObject({ provider, email: 'person@gmail.com' });
        await expect(exchangePersonalCode(provider, url, 'expected-state', 'expected-nonce', verifier)).rejects.toThrow();
        mockProvider('wrong-nonce');
        await expect(exchangePersonalCode(provider, url, 'expected-state', 'expected-nonce', verifier)).rejects.toThrow();
    });
});
