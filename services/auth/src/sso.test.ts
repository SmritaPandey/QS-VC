import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exchangeBrokerCode } from './sso-keycloak.js';
import { brokerAlias, passwordBlocked, trustedClaims, type Connection } from './sso-store.js';
import { loopback } from './sso-browser.js';

const connection: Connection = {
    id: 'e0239b0f-a9de-4b91-af9c-d791e53c7f88', tenant_id: '01a66bb4-bc01-4f21-abec-3beaa5a60bd8',
    provider: 'oidc', domain: 'tenant.example', dns_token: 'test', verified_at: new Date(), tested_at: new Date(), enforce_sso: true,
};
const claims = { sub: 'broker-subject', email: 'member@tenant.example', email_verified: true, qsvc_idp: brokerAlias(connection.id) };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('enterprise identity boundary', () => {
    it('requires a verified connection and the exact verified email domain and alias', () => {
        expect(trustedClaims(connection, claims).subject).toBe('broker-subject');
        expect(() => trustedClaims({ ...connection, verified_at: null }, claims)).toThrow();
        expect(() => trustedClaims(connection, { ...claims, email: 'member@sub.tenant.example' })).toThrow();
        expect(() => trustedClaims(connection, { ...claims, qsvc_idp: 'other-provider' })).toThrow();
        expect(() => trustedClaims(connection, { ...claims, email_verified: false })).toThrow();
        expect(() => trustedClaims(connection, claims, 'different@tenant.example')).toThrow();
    });

    it('blocks password login for a verified enforced domain, except platform administrators', async () => {
        vi.stubEnv('QSVC_DEPLOYMENT', 'onprem');
        vi.stubEnv('QSVC_ADMIN_EMAILS', 'admin@tenant.example');
        const query = vi.fn(async (sql: string, params?: string[]) =>
            ({ rows: sql.includes('FROM sso_connections') && params?.[0] === connection.domain ? [connection] : [] }));
        const pool = { connect: async () => ({ query, release() {} }) } as unknown as Pool;
        await expect(passwordBlocked(pool, 'member@TENANT.EXAMPLE')).resolves.toBe(true);
        await expect(passwordBlocked(pool, 'member@unverified.example')).resolves.toBe(false);
        const before = query.mock.calls.length;
        await expect(passwordBlocked(pool, 'admin@tenant.example')).resolves.toBe(false);
        expect(query.mock.calls).toHaveLength(before);
    });

    it('only constructs numeric loopback callbacks on a fixed host', () => {
        const proof = 'a'.repeat(43);
        expect(loopback(51733, proof).href).toBe(`http://127.0.0.1:51733/sso/${proof}`);
        expect(() => loopback('443@other.example', proof)).toThrow();
        expect(() => loopback(22, proof)).toThrow();
        expect(() => loopback(51733, '//other.example')).toThrow();
    });
});

describe('signed Keycloak callback', () => {
    const broker = 'https://login.tenant.example/realms/qsvc';
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const callback = new URL('https://qsvc.tenant.example/api/auth/sso/callback?code=single-use&state=expected-state');
    const verifier = 'a'.repeat(43);
    function fakeBroker(nonce = 'expected-nonce', expiresIn = 60) {
        vi.stubEnv('QSVC_KEYCLOAK_ISSUER', broker);
        vi.stubEnv('QSVC_KEYCLOAK_INTERNAL_URL', '');
        vi.stubEnv('QSVC_KEYCLOAK_CLIENT_SECRET', 'test-secret');
        vi.stubEnv('QSVC_KEYCLOAK_CLIENT_ID', 'qsvc');
        let redeemed = false;
        const tokenRequest = vi.fn();
        vi.stubGlobal('fetch', async (input: URL | string, options?: RequestInit) => {
            const url = String(input);
            if (url.endsWith('/.well-known/openid-configuration')) return Response.json({
                issuer: broker, authorization_endpoint: `${broker}/authorize`, token_endpoint: `${broker}/token`,
                jwks_uri: `${broker}/jwks`, id_token_signing_alg_values_supported: ['RS256'],
                code_challenge_methods_supported: ['S256'],
            });
            if (url === `${broker}/jwks`) return Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' }] });
            if (url === `${broker}/token`) {
                tokenRequest();
                const params = new URLSearchParams(String(options?.body));
                if (redeemed || params.get('code_verifier') !== verifier || params.get('code') !== 'single-use') {
                    return Response.json({ error: 'invalid_grant' }, { status: 400 });
                }
                redeemed = true;
                return Response.json({
                    access_token: 'mock-access', token_type: 'Bearer',
                    id_token: jwt.sign({ ...claims, nonce }, privateKey,
                        { issuer: broker, audience: 'qsvc', algorithm: 'RS256', keyid: 'test-key', expiresIn }),
                });
            }
            throw new Error('Unexpected broker request');
        });
        return tokenRequest;
    }

    it('accepts a signed token and rejects replay of the code', async () => {
        fakeBroker();
        await expect(exchangeBrokerCode(callback, 'expected-state', 'expected-nonce', verifier)).resolves.toMatchObject(claims);
        await expect(exchangeBrokerCode(callback, 'expected-state', 'expected-nonce', verifier)).rejects.toThrow();
    });
    it('rejects a state mismatch before redeeming the code', async () => {
        const tokenRequest = fakeBroker();
        await expect(exchangeBrokerCode(callback, 'wrong-state', 'expected-nonce', verifier)).rejects.toThrow();
        expect(tokenRequest).not.toHaveBeenCalled();
    });
    it('rejects a signed token with a mismatched nonce', async () => {
        fakeBroker('wrong-nonce');
        await expect(exchangeBrokerCode(callback, 'expected-state', 'expected-nonce', verifier)).rejects.toThrow();
    });
    it('rejects an expired signed token', async () => {
        fakeBroker('expected-nonce', -300);
        await expect(exchangeBrokerCode(callback, 'expected-state', 'expected-nonce', verifier)).rejects.toThrow();
    });
});
