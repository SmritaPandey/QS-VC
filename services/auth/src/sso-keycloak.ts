import { z } from 'zod';
import { brokerAlias } from './sso-store.js';

export function secureUrl(value: string, local = false) {
    const url = new URL(value);
    if (url.username || url.password || url.hash || (url.protocol !== 'https:'
        && !(local && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
        throw new Error('A secure URL is required.');
    }
    return url;
}

export function issuer() { return secureUrl(process.env.QSVC_KEYCLOAK_ISSUER || '', process.env.NODE_ENV !== 'production'); }
export function authCallback(path = 'callback') {
    return new URL(`/api/auth/sso/${path}`, secureUrl(process.env.QSVC_SSO_AUTH_URL || '', process.env.NODE_ENV !== 'production'));
}
export const ssoEnabled = () => process.env.QSVC_SSO_ENABLED === 'true';

export function serverKeycloakUrl(url: URL): URL {
    const publicIssuer = issuer();
    const internal = process.env.QSVC_KEYCLOAK_INTERNAL_URL;
    return internal && url.origin === publicIssuer.origin ? new URL(url.pathname + url.search, internal) : url;
}

export async function oidcClient() {
    const oidc = await import('openid-client');
    const publicIssuer = issuer();
    const id = process.env.QSVC_KEYCLOAK_CLIENT_ID || 'qsvc';
    const secret = process.env.QSVC_KEYCLOAK_CLIENT_SECRET;
    if (!secret) throw new Error('SSO client secret is missing.');
    const config = await oidc.discovery(publicIssuer, id, { id_token_signed_response_alg: 'RS256' }, oidc.ClientSecretBasic(secret), {
        execute: [oidc.enableNonRepudiationChecks, ...(publicIssuer.protocol === 'http:' ? [oidc.allowInsecureRequests] : [])],
        [oidc.customFetch]: (input, init) => {
            const url = new URL(input);
            if (url.origin !== publicIssuer.origin) throw new Error('Unexpected broker endpoint.');
            return fetch(serverKeycloakUrl(url), { ...init, redirect: 'error' });
        },
    });
    config.timeout = 8;
    return { oidc, config };
}

export async function exchangeBrokerCode(callback: URL, state: string, nonce: string, verifier: string) {
    const { oidc, config } = await oidcClient();
    const tokens = await oidc.authorizationCodeGrant(config, callback, {
        pkceCodeVerifier: verifier, expectedState: state, expectedNonce: nonce, idTokenExpected: true,
    });
    return tokens.claims() ?? {};
}

const upstreamEndpoint = z.string().max(2048).refine(value => {
    try {
        const url = secureUrl(value);
        const approved = (process.env.QSVC_SSO_IDP_HOSTS || '').split(',').map(host => host.trim().toLowerCase());
        return (!url.port || url.port === '443') && approved.includes(url.hostname);
    } catch { return false; }
}, 'Identity provider URL host is not approved.');
export const providerBody = z.discriminatedUnion('provider', [
    z.object({ provider: z.literal('oidc'), issuer: upstreamEndpoint, authorizationUrl: upstreamEndpoint, tokenUrl: upstreamEndpoint,
        jwksUrl: upstreamEndpoint, clientId: z.string().trim().min(1).max(255), clientSecret: z.string().min(1).max(4096) }),
    z.object({ provider: z.literal('saml'), metadata: z.string().min(1).max(80000).refine(xml => !/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) }),
]);

async function keycloakAdmin() {
    const realm = issuer();
    const path = realm.pathname.match(/^(.*)\/realms\/([^/]+)$/);
    if (!path) throw new Error('Invalid Keycloak realm URL.');
    const clientId = process.env.QSVC_KEYCLOAK_ADMIN_CLIENT_ID || 'qsvc-idp-admin';
    const secret = process.env.QSVC_KEYCLOAK_ADMIN_CLIENT_SECRET;
    if (!clientId || !secret) throw new Error('Keycloak service account is missing.');
    const tokenUrl = new URL(`${realm.pathname}/protocol/openid-connect/token`, realm);
    const response = await fetch(serverKeycloakUrl(tokenUrl), {
        method: 'POST', body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: secret }),
        redirect: 'error', signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Keycloak service account rejected the request.');
    const { access_token } = z.object({ access_token: z.string().min(1) }).parse(await response.json());
    return (suffix: string, method: string, body?: object | FormData) => fetch(
        serverKeycloakUrl(new URL(`${path[1]}/admin/realms/${path[2]}/identity-provider/${suffix}`, realm)),
        { method, headers: { Authorization: `Bearer ${access_token}`, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) },
            body: body instanceof FormData ? body : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(8000) },
    );
}

export async function configureProvider(id: string, body: z.infer<typeof providerBody>) {
    const admin = await keycloakAdmin();
    const alias = brokerAlias(id);
    let config: Record<string, string>;
    if (body.provider === 'oidc') {
        config = {
            issuer: body.issuer, authorizationUrl: body.authorizationUrl, tokenUrl: body.tokenUrl,
            jwksUrl: body.jwksUrl, clientId: body.clientId, clientSecret: body.clientSecret, clientAuthMethod: 'client_secret_basic',
            useJwksUrl: 'true', validateSignature: 'true', pkceEnabled: 'true', pkceMethod: 'S256',
            defaultScope: 'openid email profile', disableUserInfo: 'true',
        };
    } else {
        const form = new FormData();
        form.set('providerId', 'saml');
        form.set('file', new Blob([body.metadata], { type: 'application/xml' }), 'metadata.xml');
        const imported = await admin('import-config', 'POST', form);
        if (!imported.ok) throw new Error('Keycloak could not import the SAML metadata.');
        const data = z.object({
            singleSignOnServiceUrl: upstreamEndpoint, signingCertificate: z.string().min(1), idpEntityId: z.string().min(1),
        }).parse(await imported.json());
        config = {
            idpEntityId: data.idpEntityId, singleSignOnServiceUrl: data.singleSignOnServiceUrl,
            signingCertificate: data.signingCertificate, validateSignature: 'true', wantAssertionsSigned: 'true',
            wantAuthnRequestsSigned: 'true', postBindingResponse: 'true', postBindingAuthnRequest: 'true',
            principalType: 'SUBJECT', nameIDPolicyFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
        };
    }
    const provider = { alias, providerId: body.provider, enabled: true, trustEmail: true, storeToken: false,
        hideOnLogin: true, firstBrokerLoginFlowAlias: 'qsvc-first-broker-login', config: { ...config, syncMode: 'FORCE' } };
    const created = await admin('instances', 'POST', provider);
    // Recover a partially saved provider when the application database transaction rolled back.
    if (!created.ok && !(created.status === 409 && (await admin(`instances/${alias}`, 'PUT', provider)).ok)) {
        throw new Error('Keycloak could not save this identity provider.');
    }
    const mappers = `instances/${alias}/mappers`;
    const mapperType = `${body.provider}-username-idp-mapper`;
    const name = 'QS-VC tenant-scoped username';
    if (created.status === 409) {
        const existing = await admin(mappers, 'GET');
        if (!existing.ok) throw new Error('Keycloak could not read identity provider mappings.');
        const list = z.array(z.object({ id: z.string(), name: z.string() })).parse(await existing.json());
        const previous = list.find(mapper => mapper.name === name);
        if (previous && !(await admin(`${mappers}/${previous.id}`, 'DELETE')).ok) {
            throw new Error('Keycloak could not replace the identity provider mapping.');
        }
    }
    const result = await admin(mappers, 'POST', {
        name, identityProviderAlias: alias, identityProviderMapper: mapperType,
        config: { target: 'LOCAL', syncMode: 'IMPORT', template: body.provider === 'oidc' ? '${ALIAS}.${CLAIM.sub}' : '${ALIAS}.${NAMEID}' },
    });
    if (!result.ok) throw new Error('Keycloak could not isolate identity provider usernames.');
}
