import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifySession } from './ws-attach.js';

afterEach(() => vi.unstubAllGlobals());
describe('signaling session validation', () => {
    it('uses the auth service session envelope', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ valid: true, payload: { sub: 'demo-user', sessionId: 'demo-session' } }) });
        vi.stubGlobal('fetch', fetchMock);
        expect((await verifySession('demo-token')).sub).toBe('demo-user');
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer demo-token');
    });
    it('fails closed for revoked, malformed and unavailable sessions', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
        await expect(verifySession('revoked')).rejects.toThrow();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ valid: false }) }));
        await expect(verifySession('malformed')).rejects.toThrow();
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
        await expect(verifySession('unavailable')).rejects.toThrow('offline');
    });
});
