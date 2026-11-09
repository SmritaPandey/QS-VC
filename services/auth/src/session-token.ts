import { readFileSync } from 'node:fs';
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import type { JwtPayload } from 'jsonwebtoken';
import { InvalidSessionError } from './sessions.js';

let developmentKey: string | undefined;
let signingKey: Promise<CryptoKey> | undefined;
let verificationKey: Promise<CryptoKey> | undefined;
const ISSUER = 'qsvc-auth';
const AUDIENCE = 'qsvc-session';

function privatePem() {
    if (process.env.SESSION_SIGNING_KEY_FILE) return readFileSync(process.env.SESSION_SIGNING_KEY_FILE, 'utf8');
    if (!['development', 'test'].includes(process.env.NODE_ENV || '')) throw new Error('SESSION_SIGNING_KEY_FILE is required outside development.');
    developmentKey ||= generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    return developmentKey;
}
export async function prepareSessionSigning() {
    const { importPKCS8 } = await import('jose');
    signingKey ||= importPKCS8(privatePem(), 'EdDSA');
    return signingKey;
}
export async function signSession(payload: JwtPayload, expiresIn: number) {
    const { SignJWT } = await import('jose');
    return new SignJWT(payload).setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' }).setIssuer(ISSUER).setAudience(AUDIENCE)
        .setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + expiresIn).sign(await prepareSessionSigning());
}
export async function verifySessionToken(token: string): Promise<JwtPayload> {
    const { importSPKI, jwtVerify } = await import('jose');
    verificationKey ||= Promise.resolve().then(() => importSPKI(createPublicKey(privatePem()).export({ type: 'spki', format: 'pem' }).toString(), 'EdDSA'));
    const key = await verificationKey;
    try {
        const result = await jwtVerify(token, key, { algorithms: ['EdDSA'], issuer: ISSUER, audience: AUDIENCE, requiredClaims: ['exp', 'iat', 'sub', 'sessionId', 'tenantId'] });
        return result.payload as JwtPayload;
    } catch { throw new InvalidSessionError('Invalid session'); }
}
