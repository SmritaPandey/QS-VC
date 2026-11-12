import express from 'express';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPolyBridge } from '../deploy/poly-bridge/src/index';
import type { SfuAdapter } from '../deploy/poly-bridge/src/sfuAdapter';

const mocks = vi.hoisted(() => ({
    start: vi.fn(), stop: vi.fn(), deny: vi.fn(), admit: vi.fn(), api: vi.fn(),
}));
vi.mock('../deploy/poly-bridge/src/config', () => ({ config: { apiToken: 'test-token' } }));
vi.mock('../deploy/poly-bridge/src/esl', () => ({
    FreeSwitch: class extends EventEmitter {
        deny = mocks.deny;
        admit = mocks.admit;
        api = mocks.api;
    },
}));
vi.mock('../deploy/poly-bridge/src/roomBridge', () => ({
    RoomBridge: class {
        start = mocks.start;
        stop = mocks.stop;
    },
}));

function fixture(overrides: Record<string, unknown> = {}) {
    const sfu = {
        ensureBridge: vi.fn().mockResolvedValue(undefined),
        resolveDialedNumber: vi.fn().mockResolvedValue({
            roomId: 'room', autoAdmit: false, pinRequired: false, encryption: 'optional',
        }),
        notifyLobby: vi.fn().mockResolvedValue(undefined),
        notifyLobbyLeft: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
    const bridge = createPolyBridge(sfu as unknown as SfuAdapter);
    const call = { uuid: '12345678-1234-1234-1234-123456789012', room: '1001', dialedNumber: '1001', encrypted: true };
    return { sfu, bridge, call };
}
beforeEach(() => {
    vi.clearAllMocks();
    mocks.start.mockResolvedValue(undefined);
    mocks.stop.mockResolvedValue(undefined);
    mocks.deny.mockResolvedValue('+OK');
    mocks.admit.mockResolvedValue('+OK');
});

describe('Poly numeric dial-in lifecycle', () => {
    it('keeps a waiting call retryable after FreeSWITCH rejects host admission', async () => {
        const { bridge, sfu, call } = fixture();
        bridge.freeswitch.emit('lobby', call);
        await vi.waitFor(() => expect(sfu.notifyLobby).toHaveBeenCalledOnce());
        mocks.admit.mockResolvedValueOnce('-ERR try again').mockResolvedValueOnce('+OK');
        const app = express();
        app.use('/poly', bridge.http);
        const server = createServer(app);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const address = server.address() as { port: number };
            const url = `http://127.0.0.1:${address.port}/poly/rooms/room/lobby/${call.uuid}/admit`;
            const request = { method: 'POST', headers: { Authorization: 'Bearer test-token' } };
            expect((await fetch(url, request)).status).toBe(502);
            expect(sfu.notifyLobbyLeft).not.toHaveBeenCalled();
            expect((await fetch(url, request)).status).toBe(200);
            expect(sfu.notifyLobbyLeft).toHaveBeenCalledWith('room', call.uuid);
        } finally {
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
    });

    it('rejects PIN-protected and insecure required-encryption calls before bridge creation', async () => {
        for (const policy of [
            { pinRequired: true, encryption: 'optional' },
            { pinRequired: false, encryption: 'required' },
        ]) {
            const { bridge, sfu, call } = fixture({
                resolveDialedNumber: vi.fn().mockResolvedValue({ roomId: 'room', autoAdmit: true, ...policy }),
            });
            bridge.freeswitch.emit('lobby', { ...call, encrypted: false });
            await vi.waitFor(() => expect(sfu.resolveDialedNumber).toHaveBeenCalled());
            await vi.waitFor(() => expect(mocks.deny).toHaveBeenCalledWith(call.uuid));
            expect(sfu.ensureBridge).not.toHaveBeenCalled();
            expect(mocks.admit).not.toHaveBeenCalled();
        }
    });

    it('coalesces concurrent starts and removes a numeric caller from the resolved lobby', async () => {
        const { bridge, sfu, call } = fixture();
        bridge.freeswitch.emit('lobby', call);
        bridge.freeswitch.emit('lobby', { ...call, uuid: '22345678-1234-1234-1234-123456789012' });
        await vi.waitFor(() => expect(sfu.notifyLobby).toHaveBeenCalledTimes(2));
        expect(mocks.start).toHaveBeenCalledTimes(1);
        bridge.freeswitch.emit('lobby-left', { uuid: call.uuid, room: '1001' });
        expect(sfu.notifyLobbyLeft).toHaveBeenCalledWith('room', call.uuid);
    });
});
