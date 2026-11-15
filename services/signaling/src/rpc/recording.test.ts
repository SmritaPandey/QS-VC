import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../meeting-policy.js', () => ({
    loadMeetingPolicy: vi.fn().mockResolvedValue(null),
    reportMeetingStatus: vi.fn().mockResolvedValue(undefined),
    verifySignalingAccess: vi.fn().mockResolvedValue({ allowed: true, isGuest: false })
}));
vi.mock('../sfu-client.js', () => ({ sfuClient: {
    getRtpCapabilities: vi.fn().mockResolvedValue({ rtpCapabilities: {} }),
    createTransport: vi.fn().mockResolvedValue({ id: 'transport' }),
    removePeer: vi.fn().mockResolvedValue({}),
} }));
import { handlePeerDisconnect, handleRpcMessage } from './handler.js';
import { sfuClient } from '../sfu-client.js';
import { roomManager } from '../room-manager.js';

const socket = () => ({ readyState: 1, send: vi.fn(), close: vi.fn() });
const states: any[] = [];
const connections = new Map<string, { ws: ReturnType<typeof socket>; state: any }>();
// Test browsers support encrypted media unless a test says otherwise (end-to-end encryption is on by default).
const rpc = (ws: any, state: any, method: string, params: any = {}) =>
    handleRpcMessage(ws, { jsonrpc: '2.0', id: 1, method, params: method === 'joinRoom' ? { supportsE2EE: true, ...params } : params }, state);
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

describe('public broadcast visibility', () => {
    it('announces to all admitted participants, includes late joiners, and clears on host transfer', async () => {
        const code = `live-${crypto.randomUUID().slice(0, 10)}`;
        const host = await join(code, 'owner'), member = await join(code, 'member');
        const room = roomManager.getRoom(host.state.roomId)!;
        roomManager.updateSettings(room.id, { e2eeRequired: false });
        expect((await rpc(member.ws, member.state, 'liveStreamState', { active: true, provider: 'youtube' }))?.error?.code).toBe(-32005);
        expect((await rpc(host.ws, host.state, 'liveStreamState', { active: true, provider: 'youtube' }))?.result).toEqual({ notified: true });
        expect(member.ws.send.mock.calls.map(([raw]) => JSON.parse(raw))).toContainEqual(expect.objectContaining({ method: 'liveStreamState', params: expect.objectContaining({ active: true, provider: 'youtube', displayName: 'owner' }) }));
        const late = await join(code, 'late');
        // Waiting-room admission returns its snapshot through the socket.
        const admission = late.ws.send.mock.calls.map(([raw]) => JSON.parse(raw)).find(message => message.method === 'admitted');
        expect(room.liveStream?.active).toBe(true);
        if (late.result?.result?.status !== 'waiting') expect(late.result?.result?.liveStream?.active).toBe(true);
        else expect(admission?.params?.liveStream?.active).toBe(true);
        expect((await rpc(host.ws, host.state, 'transferHost', { targetPeerId: member.state.peerId }))?.result).toEqual({ newHostId: member.state.peerId });
        expect(room.liveStream).toBeNull();
        expect(room.peers.get(host.state.peerId)?.role).toBe('co-host');
        expect(room.peers.get(member.state.peerId)?.role).toBe('host');
        expect((await rpc(host.ws, host.state, 'transferHost', { targetPeerId: late.state.peerId }))?.error).toBeDefined();
    });

    it('blocks public broadcast for E2EE meetings and clears its status when broadcaster leaves', async () => {
        const host = await join(`live-${crypto.randomUUID().slice(0, 10)}`, 'owner');
        const room = roomManager.getRoom(host.state.roomId)!;
        expect((await rpc(host.ws, host.state, 'liveStreamState', { active: true, provider: 'facebook' }))?.error?.code).toBe(-32005);
        roomManager.updateSettings(room.id, { e2eeRequired: false });
        await rpc(host.ws, host.state, 'liveStreamState', { active: true, provider: 'facebook' });
        expect(room.liveStream?.provider).toBe('facebook');
        await handlePeerDisconnect(host.state);
        expect(room.liveStream).toBeNull();
    });
});

describe('breakout admission and return', () => {
    it('requires host assignment, reuses admission, and returns through repeated visits', async () => {
        const code = `break-${crypto.randomUUID().slice(0, 8)}`;
        const host = await join(code, 'owner'), member = await join(code, 'member');
        const parentId = host.state.roomId;
        expect((await rpc(member.ws, member.state, 'createBreakoutRoom', { name: 'Team' }))?.error?.code).toBe(-32005);
        const created = await rpc(host.ws, host.state, 'createBreakoutRoom', { name: 'Team' });
        const childId = created?.result.rooms[0].roomId;
        expect(childId).toBeTruthy();
        expect((await rpc(member.ws, member.state, 'joinBreakoutRoom', { breakoutRoomId: childId }))?.error).toBeDefined();
        await rpc(host.ws, host.state, 'assignBreakoutParticipants', { breakoutRoomId: childId, peerIds: [member.state.peerId] });
        await rpc(host.ws, host.state, 'openBreakoutRooms');
        const peerId = member.state.peerId;
        for (let visit = 0; visit < 2; visit++) {
            const child = await rpc(member.ws, member.state, 'joinBreakoutRoom', { breakoutRoomId: childId });
            expect(child?.error).toBeUndefined();
            expect(member.state.roomId).toBe(childId);
            expect(member.state.peerId).toBe(peerId);
            expect(roomManager.getRoom(parentId)?.peers.has(peerId)).toBe(false);
            const back = await rpc(member.ws, member.state, 'joinBreakoutRoom', { breakoutRoomId: null });
            expect(back?.error).toBeUndefined();
            expect(member.state.roomId).toBe(parentId);
            expect(roomManager.getRoom(parentId)?.peers.has(peerId)).toBe(true);
            expect((await rpc(member.ws, member.state, 'meetingDiagnosticsSample', { rttMs: 25, jitterMs: 1, packetLossPercent: 0, audioActive: false }))?.result.accepted).toBe(true);
        }
        await rpc(member.ws, member.state, 'joinBreakoutRoom', { breakoutRoomId: childId });
        let finishRemoval!: (value: unknown) => void;
        vi.mocked(sfuClient.removePeer).mockImplementationOnce(() => new Promise(resolve => { finishRemoval = resolve; }));
        const closing = rpc(host.ws, host.state, 'closeBreakoutRooms');
        try {
            expect((await rpc(host.ws, host.state, 'openBreakoutRooms'))?.error?.message).toBe('Wait for breakout rooms to close.');
        } finally {
            finishRemoval({});
            await closing;
        }
        expect(member.ws.send.mock.calls.map(([raw]) => JSON.parse(raw))).toContainEqual(expect.objectContaining({ method: 'breakoutReturnRequired', params: expect.objectContaining({ mainRoomId: parentId }) }));
        expect((await rpc(member.ws, member.state, 'joinBreakoutRoom', { breakoutRoomId: null }))?.error).toBeUndefined();
        expect((await rpc(member.ws, member.state, 'joinBreakoutRoom', { breakoutRoomId: childId }))?.error).toBeDefined();
    });
});
