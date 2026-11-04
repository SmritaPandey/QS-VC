import { timingSafeEqual } from 'node:crypto';

export function authorizedControlRequest(authorization: string | undefined, token: string): boolean {
    if (!authorization || !token) return false;
    const expected = Buffer.from(`Bearer ${token}`);
    const supplied = Buffer.from(authorization);
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
