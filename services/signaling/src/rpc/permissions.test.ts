vi.mock('../meeting-policy.js', () => ({ loadMeetingPolicy: vi.fn().mockResolvedValue(null) }));
import { describe, it, expect, vi } from 'vitest';
vi.mock('../sfu-client.js', () => ({ sfuClient: {
    getRtpCapabilities: vi.fn().mockResolvedValue({ rtpCapabilities: {} }),
    createTransport: vi.fn().mockResolvedValue({ id: 'transport' }),
    removePeer: vi.fn().mockResolvedValue({}),
} }));
import { handleRpcMessage, handlePeerDisconnect } from './handler.js';
import { roomManager } from '../room-manager.js';

const socket = () => ({ readyState: 1, send: vi.fn(), close: vi.fn() });
const rpc = (ws: any, state: any, method: string, params: any = {}) =>
    handleRpcMessage(ws, { jsonrpc: '2.0', id: 1, method, params }, state);

describe('production meeting permissions', () => {
    it('notifies queued guests when the host ends the meeting', async () => {
        const hostWs=socket(), guestWs=socket(), host:any={}, guest:any={};
        const code=`end-${crypto.randomUUID().slice(0,10)}`;
        await rpc(hostWs,host,'joinRoom',{meetingCode:code,displayName:'Host'});
        await rpc(hostWs,host,'updateSettings',{settings:{waitingRoomEnabled:true}});
        await rpc(guestWs,guest,'joinRoom',{meetingCode:code,displayName:'Guest'});
        expect((await rpc(hostWs,host,'endMeeting'))?.result.ended).toBe(true);
        expect(guestWs.send.mock.calls.some(([raw])=>JSON.parse(raw).method==='rejected')).toBe(true);
        expect(guestWs.close).toHaveBeenCalledWith(4000,'Meeting ended');
        expect(roomManager.getRoom(host.roomId)?.waitingRoom.size).toBe(0);
        await handlePeerDisconnect(host); await handlePeerDisconnect(guest);
    });
    it('retains queued guests when locked or full and reports admit-all failures', async () => {
        const hostWs = socket(), host: any = {}, guests = [socket(), socket()], states: any[] = [{}, {}];
        const code = `admit-${crypto.randomUUID().slice(0, 10)}`;
        await rpc(hostWs, host, 'joinRoom', { meetingCode: code, displayName: 'Host' });
        await rpc(hostWs, host, 'updateSettings', { settings: { waitingRoomEnabled: true } });
        for (let i=0;i<2;i++) await rpc(guests[i], states[i], 'joinRoom', { meetingCode: code, displayName: `Guest${i}` });
        const room = roomManager.getRoom(host.roomId)!;
        room.settings.locked = true;
        expect((await rpc(hostWs, host, 'admitPeer', { targetPeerId: states[0].peerId }))?.error).toBeDefined();
        expect(room.waitingRoom.size).toBe(2);
        room.settings.locked = false; room.settings.maxParticipants = 2;
        const result = await rpc(hostWs, host, 'admitAll');
        expect(result?.result.admitted).toBe(1); expect(result?.result.failed).toHaveLength(1);
        expect(room.waitingRoom.size).toBe(1); expect(room.peers.size).toBe(2);
        for (const state of states) await handlePeerDisconnect(state);
        await handlePeerDisconnect(host);
    });
    it('prevents co-hosts from managing hosts or fellow co-hosts or ending meetings', async () => {
        const code = `roles-${crypto.randomUUID().slice(0, 10)}`;
        const sockets = [socket(),socket(),socket()], states: any[] = [{},{},{}];
        for(let i=0;i<3;i++) await rpc(sockets[i], states[i], 'joinRoom', { meetingCode: code, displayName: `User${i}` });
        for(let i=1;i<3;i++) await rpc(sockets[0],states[0],'changeRole',{targetPeerId:states[i].peerId,newRole:'co-host'});
        for(const target of [states[0],states[2]]) {
            expect((await rpc(sockets[1],states[1],'kickPeer',{targetPeerId:target.peerId}))?.error?.code).toBe(-32005);
            expect((await rpc(sockets[1],states[1],'hostMutePeer',{targetPeerId:target.peerId}))?.error?.code).toBe(-32005);
        }
        expect((await rpc(sockets[1],states[1],'endMeeting'))?.error?.code).toBe(-32005);
        expect(roomManager.getRoom(states[0].roomId)?.peers.size).toBe(3);
        for(const state of states.reverse()) await handlePeerDisconnect(state);
    });
    it('routes collaboration only to joined peers in their own room', async () => {
        const a = socket(), b = socket(), visitor = socket();
        const sa: any = {}, sb: any = {};
        await rpc(a, sa, 'joinRoom', { meetingCode: `board-a-${crypto.randomUUID().slice(0, 8)}`, displayName: 'A' });
        await rpc(b, sb, 'joinRoom', { meetingCode: `board-b-${crypto.randomUUID().slice(0, 8)}`, displayName: 'B' });
        expect((await rpc(a, sa, 'collaborationAction', { type: 'notes:update', text: 'Private room A', version: 0 }))?.result.notes.text).toBe('Private room A');
        expect((await rpc(b, sb, 'getCollaborationState'))?.result.notes.text).toBe('');
        expect((await rpc(visitor, sa, 'getCollaborationState'))?.error).toBeDefined();
        expect((await rpc(visitor, {}, 'collaborationAction', { type: 'board:clear' }))?.error).toBeDefined();
        await handlePeerDisconnect(sa); await handlePeerDisconnect(sb);
    });
    it('validates host settings without mutating the room on invalid input', async () => {
        const ws = socket(), state: any = {};
        await rpc(ws, state, 'joinRoom', { meetingCode: `settings-${crypto.randomUUID().slice(0, 12)}`, displayName: 'Host' });
        expect((await rpc(ws, state, 'updateSettings', { settings: { waitingRoomEnabled: 'false' } }))?.error).toBeDefined();
        expect(roomManager.getRoom(state.roomId)?.settings.waitingRoomEnabled).toBe(false);
        expect((await rpc(ws, state, 'updateSettings', { settings: { arbitrary: true } }))?.error).toBeDefined();
        expect((await rpc(ws, state, 'updateSettings', { settings: { maxParticipants: -1 } }))?.error).toBeDefined();
        expect((await rpc(ws, state, 'updateSettings', { settings: { waitingRoomEnabled: true } }))?.result.updated).toBe(true);
        await handlePeerDisconnect(state);
    });
    it('does not register a connection that closes during media setup', async () => {
        const ws = socket();
        const state: any = {};
        const code = `test-${crypto.randomUUID().slice(0, 12)}`;
        const joined = rpc(ws, state, 'joinRoom', { meetingCode: code, displayName: 'Leaving' });
        ws.readyState = 3;
        expect((await joined)?.error?.message).toBe('Connection closed during join');
        expect(roomManager.getRoomByCode(code)?.peers.size).toBe(0);
        expect(state.peerId).toBeUndefined();
    });
    it('ignores client host roles and only allows the server host to promote members', async () => {
        const code = `test-${crypto.randomUUID().slice(0, 12)}`;
        const hostWs = socket(), memberWs = socket();
        const host: any = {}, member: any = {};
        const first = await rpc(hostWs, host, 'joinRoom', { meetingCode: code, displayName: 'Demo host' });
        const second = await rpc(memberWs, member, 'joinRoom', { meetingCode: code, displayName: 'Demo guest', role: 'host' });
        expect(first?.result.role).toBe('host');
        expect(second?.result.role).toBe('member');
        expect((await rpc(memberWs, member, 'changeRole', { targetPeerId: member.peerId, newRole: 'co-host' }))?.error?.code).toBe(-32005);
        expect((await rpc(memberWs, member, 'muteAll'))?.error?.code).toBe(-32005);
        expect((await rpc(hostWs, host, 'changeRole', { targetPeerId: member.peerId, newRole: 'co-host' }))?.result.changed).toBe(true);
        expect((await rpc(memberWs, member, 'changeRole', { targetPeerId: host.peerId, newRole: 'member' }))?.error?.code).toBe(-32005);
        expect((await rpc(memberWs, member, 'muteAll'))?.result.mutedAll).toBe(true);
        expect((await rpc(memberWs, member, 'joinRoom', { meetingCode: code, displayName: 'Again' }))?.error).toBeDefined();
        await handlePeerDisconnect(host);
        expect(roomManager.getRoom(member.roomId)?.hostPeerId).toBe(member.peerId);
        await handlePeerDisconnect(member);
    });

    it('rejects concurrent joins and prevents waiting peers from sending chat', async () => {
        const code = `test-${crypto.randomUUID().slice(0, 12)}`;
        const hostWs = socket(), guestWs = socket();
        const host: any = {}, guest: any = {};
        const [first, repeated] = await Promise.all([
            rpc(hostWs, host, 'joinRoom', { meetingCode: code, displayName: 'Host' }),
            rpc(hostWs, host, 'joinRoom', { meetingCode: code, displayName: 'Duplicate' }),
        ]);
        expect(first?.result.role).toBe('host');
        expect(repeated?.error).toBeDefined();
        await rpc(hostWs, host, 'updateSettings', { settings: { waitingRoomEnabled: true } });
        expect((await rpc(guestWs, guest, 'joinRoom', { meetingCode: code, displayName: 'Waiting', role: 'co-host' }))?.result.status).toBe('waiting');
        expect((await rpc(guestWs, guest, 'chatMessage', { content: 'Not admitted' }))?.error).toBeDefined();
        await rpc(hostWs, host, 'admitPeer', { targetPeerId: guest.peerId });
        expect((await rpc(guestWs, guest, 'chatMessage', { content: 'Admitted' }))?.result.sent).toBe(true);
        expect((await rpc(guestWs, guest, 'muteAll'))?.error?.code).toBe(-32005);
        await handlePeerDisconnect(guest);
        await handlePeerDisconnect(host);
    });
});

it('rejects guests before a saved organiser and restores the saved owner role', async () => {
    const { loadMeetingPolicy } = await import('../meeting-policy.js');
    vi.mocked(loadMeetingPolicy).mockResolvedValue({hostId:'owner',status:'waiting',settings:{waitingRoomEnabled:true,allowChat:false,allowScreenShare:true,allowRecording:false}});
    const code=`owner-${crypto.randomUUID().slice(0,10)}`;
    const guest=socket(), guestState:any={};
    expect((await rpc(guest,guestState,'joinRoom',{meetingCode:code,displayName:'Guest'}))?.error?.message).toContain('organiser');
    const host=socket(), hostState:any={authUser:{sub:'owner'}};
    const result=await rpc(host,hostState,'joinRoom',{meetingCode:code,displayName:'Owner'});
    expect(result?.result.role).toBe('host');
    expect(roomManager.getRoom(hostState.roomId)?.settings.allowChat).toBe(false);
    expect((await rpc(guest,guestState,'joinRoom',{meetingCode:code,displayName:'Guest'}))?.result.status).toBe('waiting');
    await handlePeerDisconnect(guestState); await handlePeerDisconnect(hostState);
    vi.mocked(loadMeetingPolicy).mockResolvedValue(null);
});
