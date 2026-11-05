import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../meeting-policy.js', () => ({ loadMeetingPolicy: vi.fn().mockResolvedValue(null) }));
vi.mock('../sfu-client.js', () => ({ sfuClient: {
    getRtpCapabilities: vi.fn().mockResolvedValue({ rtpCapabilities: {} }),
    createTransport: vi.fn().mockResolvedValue({ id: 'transport' }),
    removePeer: vi.fn().mockResolvedValue({}),
} }));
import { handlePeerDisconnect, handleRpcMessage } from './handler.js';
import { roomManager } from '../room-manager.js';

const socket = () => ({ readyState: 1, send: vi.fn(), close: vi.fn() });
const states: any[] = [];
const connections = new Map<string, { ws: ReturnType<typeof socket>; state: any }>();
const rpc = (ws: any, state: any, method: string, params: any = {}) =>
    handleRpcMessage(ws, { jsonrpc: '2.0', id: 1, method, params }, state);
async function join(code: string, userId?: string) {
    const ws = socket(), state: any = userId ? { authUser: { sub: userId } } : {};
    states.push(state);
    const result = await rpc(ws, state, 'joinRoom', { meetingCode: code, displayName: userId || 'Guest' });
    if (state.peerId) connections.set(state.peerId, { ws, state });
    if (result?.result?.status === 'waiting') {
        const room = roomManager.getRoomByCode(code);
        const host = room?.hostPeerId ? connections.get(room.hostPeerId) : undefined;
        if (host) await rpc(host.ws, host.state, 'admitPeer', { targetPeerId: state.peerId });
    }
    return { ws, state, result };
}
const notifications = (ws: ReturnType<typeof socket>) => ws.send.mock.calls
    .map(([raw]) => JSON.parse(raw)).filter(message => message.method === 'recordingStateChanged');
afterEach(async () => { for (const state of states.splice(0).reverse()) await handlePeerDisconnect(state); connections.clear(); });

describe('recording notifications', () => {
    it('requires the signed-in host, rejects stale sockets and validates the state', async () => {
        const code = `rec-${crypto.randomUUID().slice(0, 10)}`;
        const host = await join(code, 'owner'), member = await join(code, 'member');
        expect((await rpc(member.ws, member.state, 'setRecordingState', { recording: true }))?.error?.code).toBe(-32005);
        await rpc(host.ws, host.state, 'changeRole', { targetPeerId: member.state.peerId, newRole: 'co-host' });
        expect((await rpc(member.ws, member.state, 'setRecordingState', { recording: true }))?.error?.code).toBe(-32005);
        expect((await rpc(socket(), host.state, 'setRecordingState', { recording: true }))?.error).toBeDefined();
        for (const params of [{ recording: 'true' }, { recording: true, extra: true }, {}]) {
            expect((await rpc(host.ws, host.state, 'setRecordingState', params))?.error?.code).toBe(-32602);
        }
        expect(roomManager.getRoom(host.state.roomId)?.recording).toBeNull();
        const guestHost = await join(`guest-${crypto.randomUUID().slice(0, 10)}`);
        expect((await rpc(guestHost.ws, guestHost.state, 'setRecordingState', { recording: true }))?.error?.code).toBe(-32005);
    });

    it('broadcasts start/stop, includes late joiners and cannot replace another recording session', async () => {
        const code = `rec-${crypto.randomUUID().slice(0, 10)}`;
        const host = await join(code, 'owner'), member = await join(code);
        const recording = { peerId: host.state.peerId, displayName: 'owner' };
        expect((await rpc(host.ws, host.state, 'setRecordingState', { recording: true }))?.result.recording).toEqual(recording);
        expect(notifications(host.ws).at(-1).params.recording).toEqual(recording);
        expect(notifications(member.ws).at(-1).params.recording).toEqual(recording);
        const late = await join(code);
        const admission = late.ws.send.mock.calls.map(([raw]) => JSON.parse(raw)).find(message => message.method === 'admitted');
        expect(admission?.params.recording).toEqual(recording);
        const room = roomManager.getRoom(host.state.roomId)!;
        room.peers.get(member.state.peerId)!.role = 'host';
        room.peers.get(member.state.peerId)!.userId = 'other-owner-session';
        expect((await rpc(member.ws, member.state, 'setRecordingState', { recording: true }))?.error?.code).toBe(-32005);
        expect((await rpc(member.ws, member.state, 'setRecordingState', { recording: false }))?.error?.code).toBe(-32005);
        expect(room.recording).toEqual(recording);
        expect((await rpc(host.ws, host.state, 'setRecordingState', { recording: false }))?.result.recording).toBeNull();
        expect(notifications(member.ws).at(-1).params.recording).toBeNull();
    });

    it('clears recording on departure and meeting end before leaving participants stale', async () => {
        const code = `rec-${crypto.randomUUID().slice(0, 10)}`;
        const host = await join(code, 'owner'), member = await join(code, 'member');
        await rpc(host.ws, host.state, 'setRecordingState', { recording: true });
        const roomId = host.state.roomId;
        await handlePeerDisconnect(host.state);
        expect(roomManager.getRoom(roomId)?.recording).toBeNull();
        expect(notifications(member.ws).at(-1).params.recording).toBeNull();
        await rpc(member.ws, member.state, 'setRecordingState', { recording: true });
        expect(roomManager.getRoom(roomId)?.recording?.peerId).toBe(member.state.peerId);
        await rpc(member.ws, member.state, 'endMeeting');
        expect(roomManager.getRoom(roomId)?.recording).toBeNull();
        expect(notifications(member.ws).at(-1).params.recording).toBeNull();
    });

    it('honors meeting recording restrictions and clears active state when disabled', async () => {
        const host = await join(`rec-${crypto.randomUUID().slice(0, 10)}`, 'owner');
        const room = roomManager.getRoom(host.state.roomId)!;
        roomManager.updateSettings(room.id, { allowRecording: false });
        expect((await rpc(host.ws, host.state, 'setRecordingState', { recording: true }))?.error?.code).toBe(-32005);
        roomManager.updateSettings(room.id, { allowRecording: true });
        await rpc(host.ws, host.state, 'setRecordingState', { recording: true });
        roomManager.updateSettings(room.id, { allowRecording: false });
        expect(room.recording).toBeNull();
        expect(notifications(host.ws).at(-1).params.recording).toBeNull();
    });
});
