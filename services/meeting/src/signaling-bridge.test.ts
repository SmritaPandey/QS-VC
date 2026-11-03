import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { attachSignalingIfAvailable } from './signaling-bridge';

afterEach(() => vi.unstubAllEnvs());

describe('combined meeting server startup', () => {
    it('rejects startup when explicitly configured signaling cannot load', async () => {
        vi.stubEnv('SIGNALING_DIST', '/missing-qsvc-bundle/ws-attach.js');
        await expect(attachSignalingIfAvailable(http.createServer())).rejects.toThrow();
    });
    it('uses the Render-assigned port for its internal meeting policy lookup', async () => {
        vi.stubEnv('SIGNALING_DIST', '/missing-qsvc-bundle/ws-attach.js');
        vi.stubEnv('MEETING_INTERNAL_URL', '');
        vi.stubEnv('PORT', '10000');
        await expect(attachSignalingIfAvailable(http.createServer())).rejects.toThrow();
        expect(process.env.MEETING_INTERNAL_URL).toBe('http://127.0.0.1:10000');
    });
    it('preserves an explicitly configured meeting service', async () => {
        vi.stubEnv('SIGNALING_DIST', '/missing-qsvc-bundle/ws-attach.js');
        vi.stubEnv('MEETING_INTERNAL_URL', 'http://meeting:4003');
        await expect(attachSignalingIfAvailable(http.createServer())).rejects.toThrow();
        expect(process.env.MEETING_INTERNAL_URL).toBe('http://meeting:4003');
    });
});
