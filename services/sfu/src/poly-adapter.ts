import { z } from 'zod';
import type { types as ms } from 'mediasoup';
import type { Room } from './mediasoup/room.js';

type BrowserProducer = {
    producerId: string;
    peerId: string;
    displayName: string;
    kind: ms.MediaKind;
    source: 'mic' | 'cam' | 'screen';
};
type Participant = { callId: string; displayName: string; protocol: 'sip' | 'h323'; encrypted: boolean };
type Snapshot = {
    producers: Map<string, { producerId: string; peerId: string; displayName: string; kind: ms.MediaKind }>;
    lobby: Map<string, Participant>;
    roster: Map<string, Participant & { muted: boolean }>;
};

export function createPolyAdapter(findRoom: (id: string) => Room | undefined, ensureRoom?: (id: string) => Promise<Room>) {
    const states = new WeakMap<Room, Snapshot>();
    const requireRoom = (id: string) => {
        const room = findRoom(id);
        if (!room || room.isClosed()) throw new Error('QSVC media room unavailable');
        return room;
    };
    const state = (room: Room) => {
        let snapshot = states.get(room);
        if (!snapshot) {
            snapshot = { producers: new Map(), lobby: new Map(), roster: new Map() };
            states.set(room, snapshot);
        }
        return snapshot;
    };
    const describe = (room: Room, peerId: string, producer: ms.Producer): BrowserProducer => ({
        producerId: producer.id,
        peerId,
        displayName: room.getPeer(peerId)?.displayName ?? 'Participant',
        kind: producer.kind,
        source: producer.appData.source === 'screen' ? 'screen' : producer.kind === 'audio' ? 'mic' : 'cam',
    });
    const participant = ({ callId, displayName, protocol, encrypted }: Participant): Participant =>
        ({ callId, displayName, protocol, encrypted });
    return {
        async ensureBridge(roomId: string) {
            if (ensureRoom) await ensureRoom(roomId);
            else requireRoom(roomId);
        },
        async resolveDialedNumber(number: string, pin?: string) {
            if (!/^[0-9]{3,10}$/.test(number)) return null;
            const base = process.env.SIGNALING_URL || 'http://127.0.0.1:4001';
            const response = await fetch(base + '/api/internal/room-numbers/' + number + '/resolve', {
                method: 'POST', redirect: 'error', signal: AbortSignal.timeout(6000),
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.BRIDGE_API_TOKEN },
                body: JSON.stringify({ ...(pin ? { pin } : {}) }),
            });
            if (response.status === 404) return null;
            if (!response.ok) throw new Error('Numeric room lookup unavailable');
            return z.object({
                roomId: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/),
                meetingCode: z.string(), autoAdmit: z.boolean(), pinRequired: z.boolean(),
                pinVerified: z.boolean(), encryption: z.enum(['required', 'optional']),
            }).parse(await response.json());
        },
        async getRouter(roomId: string) { return requireRoom(roomId).router; },
        async listBrowserProducers(roomId: string) {
            const room = requireRoom(roomId);
            return room.getPeers().flatMap(peer => peer.getProducers()
                .filter(producer => !producer.closed)
                .map(producer => describe(room, peer.id, producer)));
        },
        onBrowserProducers(roomId: string, handlers: { added: (value: BrowserProducer) => void; removed: (id: string) => void }) {
            const room = requireRoom(roomId);
            const watched = new Map<ms.Producer, () => void>();
            const watch = (producer: ms.Producer) => {
                if (producer.closed || watched.has(producer)) return;
                const close = () => { watched.delete(producer); handlers.removed(producer.id); };
                watched.set(producer, close);
                producer.observer.once('close', close);
            };
            const added = ({ peerId, producer }: { peerId: string; producer: ms.Producer }) => {
                if (producer.closed) return;
                watch(producer);
                handlers.added(describe(room, peerId, producer));
            };
            room.on('newProducer', added);
            for (const peer of room.getPeers()) for (const producer of peer.getProducers()) watch(producer);
            return () => {
                room.off('newProducer', added);
                for (const [producer, close] of watched) producer.observer.off('close', close);
                watched.clear();
            };
        },
        async announceBridgeProducer(roomId: string, peer: { id: string; displayName: string }, producer: ms.Producer) {
            const room = requireRoom(roomId);
            if (producer.closed) throw new Error('Bridge producer already closed');
            const producers = state(room).producers;
            producers.set(producer.id, { producerId: producer.id, peerId: peer.id, displayName: peer.displayName, kind: producer.kind });
            producer.observer.once('close', () => producers.delete(producer.id));
        },
        async withdrawBridgeProducer(roomId: string, producerId: string) {
            const room = findRoom(roomId);
            if (room) state(room).producers.delete(producerId);
        },
        async notifyLobby(roomId: string, value: Participant) { state(requireRoom(roomId)).lobby.set(value.callId, participant(value)); },
        async notifyLobbyLeft(roomId: string, callId: string) {
            const room = findRoom(roomId);
            if (room) state(room).lobby.delete(callId);
        },
        async rosterUpsert(roomId: string, value: Participant & { muted: boolean }) {
            state(requireRoom(roomId)).roster.set(value.callId, { ...participant(value), muted: value.muted });
        },
        async rosterRemove(roomId: string, callId: string) {
            const room = findRoom(roomId);
            if (room) state(room).roster.delete(callId);
        },
        snapshot(roomId: string) {
            const { producers, lobby, roster } = state(requireRoom(roomId));
            return { producers: [...producers.values()], lobby: [...lobby.values()], roster: [...roster.values()] };
        },
    };
}
