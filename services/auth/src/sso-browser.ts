import type { Request, Response } from 'express';
import { z } from 'zod';
import { secureUrl } from './sso-keycloak.js';
import { isProof, proofHash, randomProof } from './sso-store.js';

const returnPath = '/sso/complete';
const cookieName = (state: string, secure: boolean) => `${secure ? '__Host-' : ''}qsvc-sso-${state}`;

export function webReturn() {
    return new URL(returnPath, secureUrl(process.env.QSVC_SSO_WEB_URL || '', process.env.NODE_ENV !== 'production'));
}

export function readBinding(req: Request, res: Response, state: string, callback: URL) {
    const secure = callback.protocol === 'https:';
    const name = cookieName(state, secure);
    const value = req.headers.cookie?.split(/;\s*/).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
    res.clearCookie(name, { httpOnly: true, secure, sameSite: 'lax', path: '/' });
    return isProof(value) ? proofHash(value) : undefined;
}
export function bindBrowser(res: Response, state: string, callback: URL) {
    const secure = callback.protocol === 'https:';
    const value = randomProof();
    res.cookie(cookieName(state, secure), value, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 5 * 60 * 1000 });
    return proofHash(value);
}

export function loopback(port: unknown, path: unknown) {
    const parsed = z.coerce.number().int().min(1024).max(65535).safeParse(port);
    if (!parsed.success || !isProof(path)) throw new Error('Invalid desktop callback.');
    return new URL(`http://127.0.0.1:${parsed.data}/sso/${path}`);
}

