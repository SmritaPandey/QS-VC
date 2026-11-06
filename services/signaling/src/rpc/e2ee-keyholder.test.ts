vi.mock('../meeting-policy.js', () => ({ loadMeetingPolicy: vi.fn().mockResolvedValue(null), reportMeetingStatus: vi.fn().mockResolvedValue(undefined) }));
import { describe, it, expect, vi } from 'vitest';
vi.mock('../sfu-client.js', () => ({ sfuClient: {
    getRtpCapabilities: vi.fn().mockResolvedValue({ rtpCapabilities: {} }),
    createTransport: vi.fn().mockResolvedValue({ id: 'transport' }),
    removePeer: vi.fn().mockResolvedValue({}),
} }));
import { handleRpcMessage, handlePeerDisconnect } from './handler.js';
import { roomManager } from '../room-manager.js';

const socket = () => ({ readyState: 1, send: vi.fn(), close: vi.fn(), bufferedAmount: 0 });
const rpc = (ws: any, state: any, method: string, params: any = {}) => handleRpcMessage(ws, { jsonrpc: '2.0', id: 1, method, params }, state);
const bundle = (peerId: string, tag: string) => ({ peerId, kemPublicKey: btoa(`kem-${tag}`), signingPublicKey: btoa(`sig-${tag}`), signature: btoa(`s-${tag}`) });
const sent = (ws: any, method: string) => ws.send.mock.calls.map(([raw]: [string]) => JSON.parse(raw)).filter((m: any) => m.method === method);

async function meeting() {
    const code = `e2ee-${crypto.randomUUID().slice(0, 10)}`;
    const hostWs = socket(), host: any = {};
    await rpc(hostWs, host, 'joinRoom', { meetingCode: code, displayName: 'Host', supportsE2EE: true });
    const guests = [socket(), socket()].map(ws => ({ ws, state: {} as any }));
    for (const g of guests) await rpc(g.ws, g.state, 'joinRoom', { meetingCode: code, displayName: 'Guest', supportsE2EE: true });
    await rpc(hostWs, host, 'admitAll');
    return { code, host, hostWs, guests, room: roomManager.getRoom(host.roomId)! };
}

describe('end-to-end encryption key holder', () => {
    it('is on by default and refuses browsers that cannot encrypt media', async () => {
        const ws = socket(), state: any = {};
        const reply: any = await rpc(ws, state, 'joinRoom', { meetingCode: `e2ee-${crypto.randomUUID().slice(0, 8)}`, displayName: 'Old browser' });
        expect(reply.error.message).toMatch(/end-to-end encrypted media/);
    });

    it('elects the first registered participant, lets only the holder distribute, and hands over when it leaves', async () => {
        const { host, hostWs, guests, room } = await meeting();
        expect(room.settings.e2eeRequired).toBe(true);
        const [a, b] = guests;
        expect(a.state.peerId && b.state.peerId).toBeTruthy();

        const first: any = await rpc(hostWs, host, 'exchangeE2EEKeys', bundle(host.peerId, 'host'));
        expect(first.result).toMatchObject({ keyHolderPeerId: host.peerId, generate: true });
        const second: any = await rpc(a.ws, a.state, 'exchangeE2EEKeys', bundle(a.state.peerId, 'a'));
        expect(second.result).toMatchObject({ keyHolderPeerId: host.peerId, generate: false });
        await rpc(b.ws, b.state, 'exchangeE2EEKeys', bundle(b.state.peerId, 'b'));

        const envelope = { senderPeerId: a.state.peerId, targetPeerId: b.state.peerId, keyId: 1, ciphertext: 'x', iv: 'x', encryptedKey: 'x', signature: 'x' };
        const forged: any = await rpc(a.ws, a.state, 'distributeEpochKey', { targetPeerId: b.state.peerId, envelope });
        expect(forged.error.message).toMatch(/key holder/);
        const ok: any = await rpc(hostWs, host, 'distributeEpochKey', { targetPeerId: a.state.peerId, envelope: { ...envelope, senderPeerId: host.peerId, targetPeerId: a.state.peerId } });
        expect(ok.result.delivered).toBe(true);
        expect(sent(a.ws, 'e2eeEpochKey')[0].params.keyHolderPeerId).toBe(host.peerId);

        // A confirmed key holder is preferred when the holder leaves; it rotates (generate=false means rotate the held key).
        await rpc(a.ws, a.state, 'e2eeKeyReceived');
        const hostPeerId = host.peerId;
        await handlePeerDisconnect(host);
        expect(room.e2eeKeyHolderPeerId).toBe(a.state.peerId);
        const change = sent(b.ws, 'e2eeKeyHolderChanged').at(-1);
        expect(change.params).toMatchObject({ peerId: a.state.peerId, previousHolderPeerId: hostPeerId, generate: false });

        // If nobody has confirmed the key, the next holder is told to generate a new one.
        b.state.peerId && (room.peers.get(b.state.peerId)!.e2eeKeyReady = false);
        await handlePeerDisconnect(a.state);
        expect(room.e2eeKeyHolderPeerId).toBe(b.state.peerId);
        expect(sent(b.ws, 'e2eeKeyHolderChanged').at(-1).params).toMatchObject({ peerId: b.state.peerId, generate: true });
        await handlePeerDisconnect(b.state);
    });

    it('keeps room-system rooms on transport encryption so SIP/H.323 bridges can mix audio', () => {
        const room = roomManager.getOrCreatePersistentRoom(`room-${crypto.randomUUID().slice(0, 8)}`, { autoAdmit: true });
        expect(room.settings.e2eeRequired).toBe(false);
    });
});
