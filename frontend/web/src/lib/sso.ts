import { AUTH_API, getToken } from './session';

export async function ssoRequest<T>(path: string, method = 'GET', body?: object, authenticated = false): Promise<T> {
    const response = await fetch(`${AUTH_API}/api/auth/sso/${path}`, {
        method, cache: 'no-store', signal: AbortSignal.timeout(10000),
        headers: {
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(authenticated ? { Authorization: `Bearer ${getToken()}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || 'This sign-in option is unavailable.');
    return result;
}

export async function browserProof() {
    const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    return { verifier, challenge };
}
