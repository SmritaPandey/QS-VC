import { describe, expect, it } from 'vitest';
import { resolveClientAddress } from './ws-attach.js';

describe('signaling client address resolution', () => {
    const request = (headers: Record<string, string>, remoteAddress = '172.18.0.5') => ({
        headers,
        socket: { remoteAddress },
    }) as any;

    it('uses only the trusted client IP header configured by the deployment', () => {
        expect(resolveClientAddress(request({ 'x-qsvc-client-ip': '203.0.113.7' }), 'x-qsvc-client-ip'))
            .toBe('203.0.113.7');
    });

    it('uses the first X-Forwarded-For address only when the proxy header is explicitly trusted', () => {
        expect(resolveClientAddress(request({ 'x-forwarded-for': '203.0.113.8, 10.0.0.2' }), 'x-forwarded-for'))
            .toBe('203.0.113.8');
    });

    it('ignores attacker-supplied forwarding headers when no trusted proxy is configured', () => {
        expect(resolveClientAddress(request({ 'x-forwarded-for': '198.51.100.9' }, '172.18.0.5'), ''))
            .toBe('172.18.0.5');
    });
});
