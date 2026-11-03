import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createRecordingApp } from './app.js';

describe('demo recording API', () => {
    let server: Server;
    let base: string;
    beforeAll(async () => {
        server = createRecordingApp().listen(0, '127.0.0.1');
        await new Promise<void>((resolve, reject) => {
            server.once('listening', resolve);
            server.once('error', reject);
        });
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing server address');
        base = `http://127.0.0.1:${address.port}`;
    });
    afterAll(async () => {
        if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    it.each([
        ['POST', '/api/recordings/start'],
        ['POST', '/api/recordings/id/upload'],
        ['POST', '/api/recordings/id/complete'],
        ['POST', '/api/recordings/id/stop'],
        ['GET', '/api/recordings/id'],
        ['GET', '/api/recordings/id/download'],
        ['GET', '/api/meetings/id/recordings'],
        ['DELETE', '/api/recordings/id'],
    ])('blocks %s %s before validation or storage', async (method, path) => {
        const response = await fetch(`${base}${path}`, {
            method,
            headers: { Authorization: 'Bearer demo', 'Content-Type': 'application/json' },
            ...(method === 'POST' ? { body: '{invalid json' } : {}),
        });
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({
            code: 'RECORDING_DISABLED', error: 'Recording is disabled for this demo.',
        });
    });
    it('keeps health available and reports the disabled capability', async () => {
        const response = await fetch(`${base}/health`);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ recordingEnabled: false });
    });
    it('blocks anonymous access as well', async () => {
        const response = await fetch(`${base}/api/recordings/id/download`);
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: 'RECORDING_DISABLED' });
    });
});
