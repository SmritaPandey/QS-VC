import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { types as ms } from 'mediasoup';
import { createPolyAdapter } from './poly-adapter.js';
import type { Room } from './mediasoup/room.js';

function fixture() {
    const producer = { id: 'mic', kind: 'audio', appData: {}, closed: false, observer: new EventEmitter() };
    const peer = { id: 'browser', displayName: 'Browser', getProducers: () => [producer] };
    const room = Object.assign(new EventEmitter(), {
        router: {}, isClosed: () => false, getPeers: () => [peer], getPeer: () => peer,
    });
    const adapter = createPolyAdapter(id => id === 'room' ? room as unknown as Room : undefined);
    return { adapter, room, producer };
}

afterEach(() => vi.unstubAllGlobals());

describe('Poly SFU adapter', () => {
    it('creates SFU resources for a host-started bridge and rejects unconfigured number lookup', async () => {
        const { room } = fixture();
        const ensureRoom = vi.fn().mockResolvedValue(room);
        const adapter = createPolyAdapter(() => undefined, ensureRoom);
        await adapter.ensureBridge('new-room');
        expect(ensureRoom).toHaveBeenCalledExactlyOnceWith('new-room');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 503, ok: false }));
        await expect(adapter.resolveDialedNumber('1001')).rejects.toThrow('Numeric room lookup unavailable');
    });

    it('uses the existing router and detaches browser media listeners on teardown', async () => {
        const { adapter, room, producer } = fixture();
        expect(await adapter.getRouter('room')).toBe(room.router);
        await expect(adapter.getRouter('other')).rejects.toThrow('media room unavailable');
        expect(await adapter.listBrowserProducers('room')).toEqual([
            { producerId: 'mic', peerId: 'browser', displayName: 'Browser', kind: 'audio', source: 'mic' },
        ]);
        const handlers = { added: vi.fn(), removed: vi.fn() };
        const unsubscribe = adapter.onBrowserProducers('room', handlers);
        room.emit('newProducer', { peerId: 'browser', producer });
        expect(handlers.added).toHaveBeenCalledWith(expect.objectContaining({ producerId: 'mic' }));
        producer.observer.emit('close');
        expect(handlers.removed).toHaveBeenCalledExactlyOnceWith('mic');
        unsubscribe();
        room.emit('newProducer', { peerId: 'browser', producer });
        expect(handlers.added).toHaveBeenCalledTimes(1);
    });

    it('relays only public roster fields and clears closed producers and departed calls', async () => {
        const { adapter, producer } = fixture();
        const member = { callId: 'call', displayName: 'Poly', protocol: 'sip' as const, encrypted: true, muted: false, remoteAddress: '10.0.0.1' };
        await adapter.notifyLobby('room', member);
        await adapter.rosterUpsert('room', member);
        await adapter.announceBridgeProducer('room', { id: 'poly-room', displayName: 'Poly room' }, producer as unknown as ms.Producer);
        const snapshot = adapter.snapshot('room');
        expect(snapshot.producers).toHaveLength(1);
        expect(snapshot.roster[0]).not.toHaveProperty('remoteAddress');
        expect(snapshot.lobby[0]).not.toHaveProperty('remoteAddress');
        producer.observer.emit('close');
        await adapter.notifyLobbyLeft('room', member.callId);
        await adapter.rosterRemove('room', member.callId);
        expect(adapter.snapshot('room')).toEqual({ producers: [], lobby: [], roster: [] });
    });
});
