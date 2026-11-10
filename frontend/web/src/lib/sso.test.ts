import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignInRequestError, ssoRequest } from './sso';

afterEach(() => vi.unstubAllGlobals());

describe('sign-in response messages', () => {
    it.each([
        new Response(null, { status: 502 }),
        new Response('', { status: 200 }),
        Response.json({ error: 'private service diagnostic' }, { status: 500 }),
    ])('gives safe guidance for an unavailable response', async response => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => response.clone()));
        await expect(ssoRequest('personal/start')).rejects.toThrow(SignInRequestError);
        await expect(ssoRequest('personal/start')).rejects.toThrow('This request could not be completed. Please try again.');
    });

    it('keeps the actionable next step for a known account conflict', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
            error: 'This email already has an account. Sign in first, then link your provider in Sign-in settings.',
        }, { status: 409 })));
        await expect(ssoRequest('personal/exchange')).rejects.toThrow('This email already has an account. Sign in first');
    });

    it('passes through a successful JSON response', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ providers: ['google'] })));
        await expect(ssoRequest('personal/providers')).resolves.toEqual({ providers: ['google'] });
    });
});
