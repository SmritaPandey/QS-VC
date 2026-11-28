import { afterEach, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { adminControlsRouter } from './admin-controls.js';
import { RoomManager, type PeerState } from './room-manager.js';
import { sfuClient } from './sfu-client.js';
import { InvalidAuthentication } from './ws-attach.js';

const nativeFetch = globalThis.fetch;
const servers: Server[] = [];
afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))));
});
async function setup() {
    const manager = new RoomManager();
    const room = manager.getOrCreateRoom('ADMIN-TEST');
    room.ownerTenantId = 'tenant';
    const peer = { id: 'participant', displayName: 'Attendee', role: 'member', ws: { readyState: 1, send: vi.fn() }, producers: new Map(), audioMuted: false, videoOff: false } as unknown as PeerState;
    room.peers.set(peer.id, peer);
    const broadcast = vi.spyOn(manager, 'broadcast');
    const send = vi.spyOn(manager, 'sendToPeer');
    const verify = vi.fn(async () => ({ sub: 'admin', tenantId: 'tenant', role: 'admin' }));
    const profile = vi.fn(async (_url?: string): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => ({ ok: true, status: 200, json: async () => ({ id: 'admin', tenantId: 'tenant', role: 'admin', isPlatformAdmin: true }) }));
    vi.stubGlobal('fetch', profile);
    const pause = vi.fn(async () => ({}));
    const audit = vi.fn();
    const app = express(); app.use(express.json());
    app.use('/api/admin/rooms', adminControlsRouter({ rooms: manager, verify, pause, audit, authUrl: 'http://auth', meetingUrl: 'http://meeting' }));
    const server = app.listen(0, '127.0.0.1'); servers.push(server);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing address');
    const request = (body?: unknown, token = 'verified') => nativeFetch(`http://127.0.0.1:${address.port}/api/admin/rooms${body === undefined ? '' : `/${room.id}/peers/${peer.id}/media`}`, {
        method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const deviceRequest = (payload: unknown) => nativeFetch(`http://127.0.0.1:${address.port}/api/admin/rooms/${room.id}/devices`, {
        method: 'POST', headers: { Authorization: 'Bearer verified', 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    return { manager, room, peer, verify, profile, pause, audit, broadcast, send, request, deviceRequest };
}

it('requires current verified authentication, failing closed on stale and unavailable verification', async () => {
    const ctx = await setup();
    expect((await ctx.request(undefined, '')).status).toBe(401);
    expect(ctx.verify).not.toHaveBeenCalled();
    ctx.verify.mockRejectedValueOnce(new InvalidAuthentication('expired'));
    expect((await ctx.request()).status).toBe(401);
    ctx.verify.mockRejectedValueOnce(new Error('private upstream failure'));
    const response = await ctx.request();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private upstream');
    expect(ctx.profile).not.toHaveBeenCalled();
    expect(ctx.pause).not.toHaveBeenCalled();
});

it('rejects a verified non-administrator before reading the live room map', async () => {
    const ctx = await setup(); ctx.verify.mockResolvedValueOnce({ sub: 'member', tenantId: 'tenant', role: 'user' });
    expect((await ctx.request()).status).toBe(403);
    expect(ctx.profile).not.toHaveBeenCalled();
});

it.each([
    { id: 'admin', tenantId: 'tenant', role: 'admin', isPlatformAdmin: false },
    { id: 'another-admin', tenantId: 'tenant', role: 'admin', isPlatformAdmin: true },
    { id: 'admin', tenantId: 'another-tenant', role: 'admin', isPlatformAdmin: true },
    { id: 'admin', tenantId: 'tenant', role: 'user', isPlatformAdmin: true },
])('rejects inconsistent or tenant-admin-only profiles: %j', async identity => {
    const ctx = await setup(); ctx.profile.mockResolvedValue({ ok: true, status: 200, json: async () => identity });
    const response = await ctx.request({ kind: 'audio', muted: true });
    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(ctx.pause).not.toHaveBeenCalled(); expect(ctx.audit).not.toHaveBeenCalled();
});

it.each([401, 503])('fails closed when the profile recheck returns %s', async status => {
    const ctx = await setup(); ctx.profile.mockResolvedValueOnce({ ok: false, status, json: async () => ({ id: 'admin', tenantId: 'tenant', role: 'admin', isPlatformAdmin: true }) });
    expect((await ctx.request()).status).toBe(status);
});

it('lists only populated rooms and public control metadata', async () => {
    const ctx = await setup(); ctx.manager.getOrCreateRoom('EMPTY');
    const response = await ctx.request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ rooms: [{ id: ctx.room.id, meetingCode: 'ADMIN-TEST', participants: [{ id: 'participant', displayName: 'Attendee' }] }] });
    expect(ctx.profile).toHaveBeenCalledWith('http://auth/api/auth/me', expect.objectContaining({ headers: { Authorization: 'Bearer verified' }, redirect: 'error' }));
});

it('pauses every current camera at the SFU, excluding screen sharing, then notifies and audits', async () => {
    const ctx = await setup();
    for (const [id, kind, source] of [['camera', 'video', 'camera'], ['camera2', 'video', 'camera:2'], ['camera3', 'video', 'camera:3'], ['camera4', 'video', 'camera:4'], ['screen', 'video', 'screen'], ['mic', 'audio', 'mic']]) ctx.peer.producers.set(id!, { id: id!, kind: kind!, appData: { source } });
    const response = await ctx.request({ kind: 'video', muted: true });
    expect(response.status).toBe(200);
    expect(ctx.pause.mock.calls).toEqual(['camera', 'camera2', 'camera3', 'camera4'].map(id => [ctx.room.id, ctx.peer.id, id, true]));
    expect(ctx.peer.videoOff).toBe(true);
    expect(ctx.broadcast).toHaveBeenCalledWith(ctx.room.id, 'peerMuteChanged', { peerId: ctx.peer.id, kind: 'video', muted: true }, ctx.peer.id);
    expect(ctx.send).toHaveBeenCalledWith(ctx.room.id, ctx.peer.id, 'forceMute', expect.objectContaining({ kind: 'video', reason: 'admin' }));
    expect(ctx.audit).toHaveBeenCalledWith({ actorId: 'admin', tenantId: 'tenant', roomId: ctx.room.id, peerId: ctx.peer.id, kind: 'video', outcome: 'paused', producerCount: 4 });
});

it('pauses public microphones while excluding private conversation and screen audio', async () => {
    const ctx = await setup();
    for (const [id, appData] of [['mic', { source: 'mic' }], ['private', { type: 'private-audio' }], ['screen', { type: 'screen' }]] as const) ctx.peer.producers.set(id, { id, kind: 'audio', appData });
    expect((await ctx.request({ kind: 'audio', muted: true })).status).toBe(200);
    expect(ctx.pause).toHaveBeenCalledExactlyOnceWith(ctx.room.id, ctx.peer.id, 'mic', true);
    expect(ctx.peer.audioMuted).toBe(true);
});

it.each([{ kind: 'video', muted: false }, { kind: 'audio', muted: true, enable: true }, { kind: 'screen', muted: true }])('rejects remote enabling and unsupported controls: %j', async body => {
    const ctx = await setup();
    expect((await ctx.request(body)).status).toBe(400);
    expect(ctx.pause).not.toHaveBeenCalled();
});

it('reports partial pause failures without claiming success or enabling anything', async () => {
    const ctx = await setup();
    ctx.peer.producers.set('mic', { id: 'mic', kind: 'audio', appData: { source: 'mic' } });
    ctx.pause.mockRejectedValueOnce(new Error('private SFU details'));
    const response = await ctx.request({ kind: 'audio', muted: true });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ partial: true });
    expect(ctx.peer.audioMuted).toBe(false);
    expect(ctx.send).not.toHaveBeenCalled();
    expect(ctx.audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }));
});

it('does not mutate or notify a participant who leaves while the pause is pending', async () => {
    const ctx = await setup();
    ctx.peer.producers.set('mic', { id: 'mic', kind: 'audio', appData: {} });
    ctx.pause.mockImplementationOnce(async () => { ctx.room.peers.delete(ctx.peer.id); return {}; });
    expect((await ctx.request({ kind: 'audio', muted: true })).status).toBe(404);
    expect(ctx.send).not.toHaveBeenCalled();
});

it('hides other tenants’ rooms and rejects media controls against them', async () => {
    const ctx = await setup();
    ctx.room.ownerTenantId = 'another-tenant';
    expect(await (await ctx.request()).json()).toMatchObject({ rooms: [] });
    expect((await ctx.request({ kind: 'audio', muted: true })).status).toBe(404);
    expect(ctx.pause).not.toHaveBeenCalled();
});

it('dials only enabled, tenant-directory SIP devices in eligible live rooms', async () => {
    const ctx = await setup();
    vi.stubEnv('POLY_BRIDGE_ENABLED', 'true');
    ctx.room.hostPeerId = ctx.peer.id;
    ctx.peer.userId = 'signed-in-host';
    const start = vi.spyOn(sfuClient, 'startPolyRoom').mockResolvedValue({});
    const dial = vi.spyOn(sfuClient, 'dialRegisteredPolycom').mockResolvedValue({ requested: true });
    const deviceId = 'fd4543d5-32ff-4cb9-a2e4-5e2d5778d406';
    ctx.room.settings.e2eeRequired = true;
    expect((await ctx.deviceRequest({ action: 'dial', deviceId })).status).toBe(409);
    ctx.room.settings.e2eeRequired = false;
    expect((await ctx.deviceRequest({ action: 'dial', deviceId, target: 'an-arbitrary-target' })).status).toBe(400);
    expect(start).not.toHaveBeenCalled();
    ctx.profile.mockImplementation(async (url?: string) => ({ ok: true, status: 200, json: async () =>
        url?.startsWith('http://meeting/')
            ? { devices: [{ id: deviceId, enabled: true, protocol: 'sip', extension: '245' }] }
            : { id: 'admin', tenantId: 'tenant', role: 'admin', isPlatformAdmin: true } }));
    expect((await ctx.deviceRequest({ action: 'dial', deviceId })).status).toBe(200);
    expect(dial).toHaveBeenCalledWith(ctx.room.id, '245');
    ctx.room.ownerTenantId = 'other-tenant';
    expect((await ctx.deviceRequest({ action: 'dial', deviceId })).status).toBe(404);
    expect(dial).toHaveBeenCalledTimes(1);
});
