import { z } from 'zod';
import { emailDomain, proofHash } from './sso-store.js';

export const personalProvider = z.enum(['google', 'microsoft']);
export type PersonalProvider = z.infer<typeof personalProvider>;
const googleIssuer = 'https://accounts.google.com';
const microsoftTenant = '9188040d-6c67-4c5b-b112-36a304b66dad';
const microsoftIssuer = `https://login.microsoftonline.com/${microsoftTenant}/v2.0`;
const microsoftDiscovery = 'https://login.microsoftonline.com/consumers/v2.0/.well-known/openid-configuration';
export const personalEmail = z.string().trim().email().max(255).transform(email => email.toLowerCase());

function credentials(provider: PersonalProvider) {
    const prefix = `QSVC_${provider.toUpperCase()}`;
    return { id: process.env[`${prefix}_CLIENT_ID`], secret: process.env[`${prefix}_CLIENT_SECRET`] };
}
export function enabledProviders() {
    if (process.env.QSVC_ENTERPRISE_TERMS_REQUIRED === 'yes') return [];
    return personalProvider.options.filter(provider => {
        const { id, secret } = credentials(provider);
        return !!id && !!secret;
    });
}

export async function personalClient(provider: PersonalProvider) {
    const { id, secret } = credentials(provider);
    if (!id || !secret) throw new Error('The provider is unavailable.');
    const oidc = await import('openid-client');
    const config = await oidc.discovery(new URL(provider === 'google' ? googleIssuer : microsoftDiscovery), id,
        { id_token_signed_response_alg: 'RS256' }, oidc.ClientSecretPost(secret), {
            execute: [oidc.enableNonRepudiationChecks],
            [oidc.customFetch]: (input, init) => fetch(input, { ...init, redirect: 'error' }),
        });
    if (config.serverMetadata().issuer !== (provider === 'google' ? googleIssuer : microsoftIssuer)) {
        throw new Error('Unexpected identity provider issuer.');
    }
    config.timeout = 8;
    return { oidc, config };
}

export function personalIdentity(provider: PersonalProvider, claims: Record<string, unknown>) {
    const issuer = provider === 'google' ? googleIssuer : microsoftIssuer;
    if (claims.iss !== issuer || (provider === 'microsoft' && claims.tid !== microsoftTenant)
        || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) {
        throw new Error('Unexpected personal identity.');
    }
    const email = personalEmail.safeParse(claims.email).data;
    const domain = email && emailDomain(email);
    const verifiedEmail = provider === 'google' && claims.email_verified === true
        && (domain === 'gmail.com' || (typeof claims.hd === 'string' && claims.hd.toLowerCase() === domain)) ? email : undefined;
    return { provider, subject: proofHash(`${issuer}\n${claims.sub}`), email, verifiedEmail,
        name: typeof claims.name === 'string' ? claims.name.trim().slice(0, 100) : '' };
}

export async function exchangePersonalCode(provider: PersonalProvider, callback: URL, state: string, nonce: string, verifier: string) {
    const { oidc, config } = await personalClient(provider);
    const tokens = await oidc.authorizationCodeGrant(config, callback, {
        pkceCodeVerifier: verifier, expectedState: state, expectedNonce: nonce, idTokenExpected: true,
    });
    return personalIdentity(provider, tokens.claims() ?? {});
}
