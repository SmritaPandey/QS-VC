import { AUTH_API, getToken } from './session';

export class SignInRequestError extends Error {}

const signInGuidance = new Map([
    ['Use the existing sign-in method for this account.', 'Use your usual sign-in method for this account.'],
    ['Use your organisation sign-in for this email address.', 'Use your organisation sign-in for this email address.'],
    ['This email already has an account. Sign in first, then link your provider in Sign-in settings.', 'This email already has an account. Sign in first, then connect your sign-in method in Settings.'],
    ['This provider is already connected. Start again from sign in.', 'This sign-in method is already connected. Return to sign in.'],
    ['Your enterprise access term is missing or expired.', 'Your workspace access may have expired. Contact your administrator.'],
    ['We could not send your verification email. Start sign-in again to retry.', 'We couldn’t send your verification email. Start sign-in again.'],
    ['The DNS TXT record is not visible yet.', 'The verification record hasn’t appeared yet. Check its name and value, then try again.'],
    ['This domain is already registered or verified.', 'This domain has already been added.'],
    ['Check the identity provider fields and approved HTTPS hosts.', 'Check the sign-in provider details and try again.'],
    ['Use an organisation account in the verified domain.', 'Use a work email that matches the verified domain.'],
    ['Verify and test the connection. Link your account first if this domain includes your email.', 'Verify and test the connection first. If your email uses this domain, link your account too.'],
]);

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
    if (!response.ok || !result || typeof result !== 'object') {
        const guidance = signInGuidance.get(result?.error);
        if (!response.ok && guidance) throw new SignInRequestError(guidance);
        if (response.status === 401) throw new SignInRequestError('This sign-in request may have expired. Start again.');
        if (response.status === 429) throw new SignInRequestError('Too many attempts. Wait a few minutes and try again.');
        if (response.status === 400 && path === 'personal/verify-email') throw new SignInRequestError('Check the eight-digit code from your email and try again.');
        if (response.status === 400 && path === 'personal/signup') throw new SignInRequestError('Check your name, email and mobile number, then try again.');
        throw new SignInRequestError('This request could not be completed. Please try again.');
    }
    return result;
}

export async function browserProof() {
    const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    return { verifier, challenge };
}
