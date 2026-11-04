import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { createRecordingApp } from './app.js';
import type { RecordingStorage, StoredObject } from './storage.js';

const video = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(12)]);
const objects = new Map<string, StoredObject>();
let unavailable = false;
let recordingAllowed = true;
const storage: RecordingStorage = {
    async put(key, body, type, ifAbsent) { if (unavailable) throw Error('S3 unavailable'); if (ifAbsent && objects.has(key)) throw { $metadata: { httpStatusCode: 412 } }; objects.set(key, { body, type, size: body.length, modified: new Date() }); },
    async get(key) { return objects.get(key) || null; },
    async head(key) { return objects.get(key) || null; },
    async remove(key) { objects.delete(key); },
    async list(prefix) { return { objects: [...objects].filter(([key]) => key.startsWith(prefix)).map(([key, item]) => ({ key, size: item.size, modified: item.modified })) }; },
    async playback(key) { return `https://private.example/${key}?signed=yes`; },
};
async function listen(app: ReturnType<typeof createRecordingApp>) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('Missing server address');
    return { server, base: `http://127.0.0.1:${address.port}` };
}
async function close(server: Server) { if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve())); }

describe('private cloud recordings', () => {
    let server: Server, base: string;
    beforeAll(async () => {
        ({ server, base } = await listen(createRecordingApp({
            storage, maxUploadBytes: 1024,
            authenticate: async authorization => authorization === 'Bearer expired' ? null : { sub: authorization === 'Bearer other' ? 'other' : 'host', tenantId: 'tenant' },
            authorizeFeature: async () => recordingAllowed ? 'allow' : 'deny',
            meeting: async code => code === 'MISSING' ? null : { hostId: 'host', status: code === 'ENDED' ? 'ended' : code === 'CANCELLED' ? 'cancelled' : 'active', settings: code === 'NO-RECORD' ? { recording_allowed: false } : {} },
        })));
    });
    afterAll(async () => { await close(server); });
    const request = (path: string, method = 'GET', body?: Buffer, token = 'host', type = 'video/webm') => fetch(`${base}/api/recordings${path}`, {
        method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': type }, ...(body ? { body } : {}),
    });
    async function upload() {
        const response = await request('/DEMO', 'POST', video);
        expect(response.status).toBe(201);
        return await response.json() as { id: string; meetingCode: string; size: number; format: string };
    }
    it('requires a current authenticated meeting owner before reading or writing', async () => {
        for (const token of ['', 'expired']) expect((await request('/DEMO', 'POST', video, token)).status).toBe(401);
        expect((await request('/DEMO', 'POST', video, 'other')).status).toBe(404);
        expect((await request('/meeting/DEMO', 'GET', undefined, 'other')).status).toBe(404);
        expect((await request('/MISSING', 'POST', video)).status).toBe(404);
        expect((await request('/NO-RECORD', 'POST', video)).status).toBe(403);
        expect(objects.size).toBe(0);
    });
    it('rejects direct guest and Starter recording API calls with the Pro requirement', async () => {
        recordingAllowed = false;
        try {
            const response = await request('/DEMO', 'POST', video);
            expect(response.status).toBe(403);
            expect(await response.json()).toEqual({ code: 'UPGRADE_REQUIRED', requiredPlan: 'pro' });
            expect(objects.size).toBe(0);
        } finally { recordingAllowed = true; }
    });
    it('rejects malformed media, unsupported MIME and over-limit uploads', async () => {
        expect((await request('/DEMO', 'POST', video, 'host', 'application/json')).status).toBe(415);
        expect((await request('/DEMO', 'POST', Buffer.alloc(16))).status).toBe(415);
        expect((await request('/DEMO', 'POST', Buffer.alloc(1025))).status).toBe(413);
        expect(objects.size).toBe(0);
    });
    it('stores video privately, lists only recording metadata and issues owner playback URLs', async () => {
        const item = await upload();
        expect(item).toMatchObject({ meetingCode: 'DEMO', size: video.length, format: 'webm' });
        const listed = await (await request('/meeting/DEMO')).json() as { recordings: { id: string; size: number }[] };
        expect(listed.recordings).toEqual([expect.objectContaining({ id: item.id, size: video.length })]);
        expect(JSON.stringify(listed)).not.toContain('private.example');
        const playback = await (await request(`/DEMO/${item.id}/playback`)).json();
        expect(playback).toMatchObject({ url: expect.stringContaining('signed=yes'), expiresIn: 300 });
        expect((await request(`/DEMO/${item.id}/playback`, 'GET', undefined, 'other')).status).toBe(404);
        expect((await request(`/DEMO/${item.id}`, 'DELETE', undefined, 'other')).status).toBe(404);
    });
    it('creates explicit share links; replacement and revocation invalidate previous tokens', async () => {
        const item = await upload();
        const share = async () => await (await request(`/DEMO/${item.id}/share`, 'POST')).json() as { token: string };
        const first = await share();
        expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect((await request(`/shared/${first.token}`, 'GET', undefined, '')).status).toBe(200);
        expect([...objects.values()].some(value => Buffer.from(value.body).toString().includes(first.token))).toBe(false);
        const second = await share();
        expect(second.token).not.toBe(first.token);
        expect((await request(`/shared/${first.token}`, 'GET', undefined, '')).status).toBe(404);
        expect((await request(`/shared/${second.token}`, 'GET', undefined, '')).status).toBe(200);
        expect((await request(`/DEMO/${item.id}/share`, 'DELETE')).status).toBe(204);
        expect((await request(`/shared/${second.token}`, 'GET', undefined, '')).status).toBe(404);
    });
    it('deletion removes media and prevents shared access and playback', async () => {
        const item = await upload();
        const { token } = await (await request(`/DEMO/${item.id}/share`, 'POST')).json() as { token: string };
        expect((await request(`/DEMO/${item.id}`, 'DELETE')).status).toBe(204);
        expect((await request(`/DEMO/${item.id}/playback`)).status).toBe(404);
        expect((await request(`/shared/${token}`, 'GET', undefined, '')).status).toBe(404);
        const list = await (await request('/meeting/DEMO')).json() as { recordings: { id: string }[] };
        expect(list.recordings.some((value: { id: string }) => value.id === item.id)).toBe(false);
    });
    it('returns an actionable error if cloud storage fails without reporting success', async () => {
        unavailable = true;
        try { expect((await request('/DEMO', 'POST', video)).status).toBe(503); }
        finally { unavailable = false; }
    });
    it('saves final video after meeting end and retries without overwriting the existing object', async () => {
        const id = '11111111-1111-4111-8111-111111111111';
        const send = (body: Buffer, uploadId = id) => fetch(`${base}/api/recordings/ENDED`, { method: 'POST', headers: { Authorization: 'Bearer host', 'Content-Type': 'video/webm', 'X-Recording-Id': uploadId }, body });
        expect((await send(video)).status).toBe(201);
        expect((await send(video)).status).toBe(200);
        const list = await (await request('/meeting/ENDED')).json() as { recordings: { id: string }[] };
        expect(list.recordings).toHaveLength(1);
        expect(list.recordings[0].id).toBe(id);
        const changed = Buffer.concat([video, Buffer.from('different')]);
        expect((await send(changed)).status).toBe(409);
        expect((await send(video, 'invalid')).status).toBe(400);
        expect((await request('/CANCELLED', 'POST', video)).status).toBe(403);
        const stored = [...objects].find(([key]) => key.endsWith(`/ENDED/${id}.webm`))![1];
        expect(Buffer.from(stored.body)).toEqual(video);
    });
});

describe('configuration and auth verification', () => {
    it('fails closed without configured storage, including legacy unauthenticated APIs', async () => {
        const previous = process.env.RECORDING_BUCKET;
        delete process.env.RECORDING_BUCKET;
        const { server, base } = await listen(createRecordingApp());
        try {
            expect(await (await fetch(`${base}/health`)).json()).toMatchObject({ recordingEnabled: false });
            expect((await fetch(`${base}/api/recordings/start`, { method: 'POST' })).status).toBe(503);
        } finally { await close(server); if (previous) process.env.RECORDING_BUCKET = previous; }
    });
    it('checks the auth service session and meeting owner, failing closed on upstream errors', async () => {
        const realFetch = globalThis.fetch;
        const app = createRecordingApp({ storage });
        const { server, base } = await listen(app);
        let verified = 0;
        vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.includes('/api/auth/me/entitlements')) return Response.json({ features: ['cloud_recording'] });
            if (url.includes('/api/auth/verify')) {
                verified++;
                return Response.json({ valid: true, payload: { sub: 'host', tenantId: 'tenant' } });
            }
            if (url.includes('/api/meetings/code/DEMO')) return Response.json({ hostId: 'host', status: 'active' });
            return realFetch(input, init);
        });
        try {
            const response = await realFetch(`${base}/api/recordings/meeting/DEMO`, { headers: { Authorization: 'Bearer session' } });
            expect(response.status).toBe(200);
            expect(verified).toBe(1);
            vi.stubGlobal('fetch', async () => { throw Error('auth offline'); });
            expect((await realFetch(`${base}/api/recordings/meeting/DEMO`, { headers: { Authorization: 'Bearer session' } })).status).toBe(503);
        } finally { vi.unstubAllGlobals(); await close(server); }
    });
});
