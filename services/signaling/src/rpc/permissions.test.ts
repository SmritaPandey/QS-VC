vi.mock('../meeting-policy.js', () => ({
    loadMeetingPolicy: vi.fn().mockResolvedValue(null),
    reportMeetingStatus: vi.fn().mockResolvedValue(undefined),
    verifySignalingAccess: vi.fn().mockResolvedValue({ allowed: true, isGuest: false })
}));
import { describe, it, expect, vi } from 'vitest';
vi.mock('../sfu-client.js', () => ({ sfuClient: {
    getRtpCapabilities: vi.fn().mockResolvedValue({ rtpCapabilities: {} }),
    createTransport: vi.fn().mockResolvedValue({ id: 'transport' }),
    removePeer: vi.fn().mockResolvedValue({}),
    closeProducer: vi.fn().mockResolvedValue({ closed: true }),
    setProducerPaused: vi.fn().mockResolvedValue({ paused: true }),
    produce: vi.fn().mockResolvedValue({ producerId: 'test-producer' }),
    consume: vi.fn().mockResolvedValue({ consumerId: 'test-consumer', producerId: 'test-producer', kind: 'audio', rtpParameters: {}, appData: {} }),
    polySnapshot: vi.fn().mockResolvedValue({ producers: [{ producerId: 'composite' }], roster: [{ callId: 'member' }], lobby: [{ callId: 'waiting' }] }),
    polyLobbyAction: vi.fn().mockResolvedValue({}),
    startPolyRoom: vi.fn().mockResolvedValue({}),
} }));
import { handleRpcMessage, handlePeerDisconnect } from './handler.js';
import { roomManager } from '../room-manager.js';
import { sfuClient } from '../sfu-client.js';
import meetingInvitation from '../../../../shared/meeting-invitation.cjs';

const socket = () => ({ readyState: 1, send: vi.fn(), close: vi.fn() });
// Test browsers support encrypted media unless a test says otherwise (end-to-end encryption is on by default).
const rpc = (ws: any, state: any, method: string, params: any = {}) =>
    handleRpcMessage(ws, { jsonrpc: '2.0', id: 1, method, params: method === 'joinRoom' ? { supportsE2EE: true, ...params } : params }, state);

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
        for(let i=1;i<3;i++) await rpc(sockets[0], states[0], 'admitPeer', { targetPeerId: states[i].peerId });
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
        expect(roomManager.getRoom(state.roomId)?.settings.waitingRoomEnabled).toBe(true);
        expect((await rpc(ws, state, 'updateSettings', { settings: { waitingRoomEnabled: false } }))?.error?.message).toContain('Host approval is required');
        expect(roomManager.getRoom(state.roomId)?.settings.waitingRoomEnabled).toBe(true);
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
        expect(second?.result.status).toBe('waiting');
        await rpc(hostWs, host, 'admitPeer', { targetPeerId: member.peerId });
        expect(sent(memberWs).find(m => m.method === 'admitted')?.params.role).toBe('member');
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

const sent = (ws: any): any[] => ws.send.mock.calls.map(([raw]: [string]) => JSON.parse(raw));
const tick = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms));

describe('private side conversations', () => {
    it('requires a signed-in host/co-host, invites only the chosen participant, and routes private audio only to the pair', async () => {
        const code = `private-${crypto.randomUUID().slice(0, 10)}`;
        const host = socket(), target = socket(), bystander = socket();
        const hostState: any = { authUser: { sub: 'host-user', plan: 'starter', status: 'paid_active' } };
        const targetState: any = {}, bystanderState: any = {};
        const caps = { codecs: [] };
        try {
            await rpc(host, hostState, 'joinRoom', { meetingCode: code, displayName: 'Host', rtpCapabilities: caps });
            await rpc(target, targetState, 'joinRoom', { meetingCode: code, displayName: 'Target', rtpCapabilities: caps });
            await rpc(bystander, bystanderState, 'joinRoom', { meetingCode: code, displayName: 'Bystander', rtpCapabilities: caps });
            await rpc(host, hostState, 'admitPeer', { targetPeerId: targetState.peerId });
            await rpc(host, hostState, 'admitPeer', { targetPeerId: bystanderState.peerId });
            const room = roomManager.getRoom(hostState.roomId)!;
            room.peers.get(hostState.peerId)!.producers.set('host-mic', { id: 'host-mic', kind: 'audio', appData: { source: 'mic' } });
            room.peers.get(targetState.peerId)!.producers.set('target-mic', { id: 'target-mic', kind: 'audio', appData: { source: 'mic' } });

            const started = await rpc(host, hostState, 'startPrivateConversation', { targetPeerId: targetState.peerId });
            expect(started?.result).toMatchObject({ status: 'invited', durationMs: 1_800_000 });
            const conversationId = started?.result.conversationId;
            expect(sent(target).some(message => message.method === 'privateConversationInvite' && message.params.conversationId === conversationId)).toBe(true);
            expect(sent(bystander).some(message => message.method === 'privateConversationInvite')).toBe(false);

            const accepted = await rpc(target, targetState, 'acceptPrivateConversation', { conversationId });
            expect(accepted?.result).toMatchObject({ status: 'active', durationMs: 1_800_000 });
            expect(sfuClient.setProducerPaused).toHaveBeenCalledWith(hostState.roomId, hostState.peerId, 'host-mic', true);
            expect(sfuClient.setProducerPaused).toHaveBeenCalledWith(hostState.roomId, targetState.peerId, 'target-mic', true);
            expect(sent(bystander).some(message => message.method === 'privateConversationStarted')).toBe(false);
            expect((await rpc(host, hostState, 'setRecordingState', { recording: true }))?.error?.message).toContain('private conversation');

            const produced = await rpc(host, hostState, 'produce', { transportId: 'send', kind: 'audio', appData: { type: 'private-audio', conversationId } });
            expect(produced?.result.producerId).toBe('test-producer');
            expect(sent(target).some(message => message.method === 'newProducer' && message.params.appData?.type === 'private-audio')).toBe(true);
            expect(sent(bystander).some(message => message.method === 'newProducer' && message.params.appData?.type === 'private-audio')).toBe(false);
            expect((await rpc(host, hostState, 'setPrivateConversationMuted', { conversationId, muted: true }))?.result.muted).toBe(true);
            expect(sfuClient.setProducerPaused).toHaveBeenCalledWith(hostState.roomId, hostState.peerId, 'test-producer', true);

            expect((await rpc(target, targetState, 'consume', { producerPeerId: hostState.peerId, producerId: 'test-producer', rtpCapabilities: caps }))?.result.appData).toMatchObject({ type: 'private-audio', conversationId });
            expect((await rpc(bystander, bystanderState, 'consume', { producerPeerId: hostState.peerId, producerId: 'test-producer', rtpCapabilities: caps }))?.error?.code).toBe(-32005);

            expect((await rpc(target, targetState, 'endPrivateConversation', { conversationId }))?.result.ended).toBe(true);
            expect(room.privateConversations.has(conversationId)).toBe(false);
            expect(room.peers.get(hostState.peerId)?.audioMuted).toBe(false);
            expect(sfuClient.setProducerPaused).toHaveBeenCalledWith(hostState.roomId, hostState.peerId, 'host-mic', false);
            expect(sfuClient.closeProducer).toHaveBeenCalledWith(hostState.roomId, hostState.peerId, 'test-producer');
            expect(sent(bystander).some(message => message.method === 'privateConversationEnded')).toBe(false);
        } finally {
            await handlePeerDisconnect(bystanderState); await handlePeerDisconnect(targetState); await handlePeerDisconnect(hostState);
        }
    });

    it('rejects unsigned hosts and declines private audio producers outside an active session', async () => {
        const code = `private-guard-${crypto.randomUUID().slice(0, 10)}`;
        const host = socket(), target = socket();
        const hostState: any = {}, targetState: any = {};
        try {
            await rpc(host, hostState, 'joinRoom', { meetingCode: code, displayName: 'Anonymous host' });
            await rpc(target, targetState, 'joinRoom', { meetingCode: code, displayName: 'Target' });
            await rpc(host, hostState, 'admitPeer', { targetPeerId: targetState.peerId });
            expect((await rpc(host, hostState, 'startPrivateConversation', { targetPeerId: targetState.peerId }))?.error?.code).toBe(-32005);
            expect((await rpc(target, targetState, 'produce', { kind: 'audio', appData: { type: 'private-audio', conversationId: 'fake-session' } }))?.error?.code).toBe(-32005);
        } finally {
            await handlePeerDisconnect(targetState); await handlePeerDisconnect(hostState);
        }
    });

    it('closes only the caller-owned producer and publishes the screen-share stop state', async () => {
        const code = `producer-close-${crypto.randomUUID().slice(0, 10)}`;
        const host = socket(), outsider = socket();
        const hostState: any = { authUser: { sub: 'host-user' } }, outsiderState: any = {};
        try {
            await rpc(host, hostState, 'joinRoom', { meetingCode: code, displayName: 'Host' });
            await rpc(outsider, outsiderState, 'joinRoom', { meetingCode: code, displayName: 'Guest' });
            await rpc(host, hostState, 'admitPeer', { targetPeerId: outsiderState.peerId });
            const room = roomManager.getRoom(hostState.roomId)!;
            room.peers.get(hostState.peerId)!.producers.set('screen-producer', { id: 'screen-producer', kind: 'video', appData: { type: 'screen' } });
            expect((await rpc(outsider, outsiderState, 'closeProducer', { producerId: 'screen-producer' }))?.error?.code).toBe(-32000);
            expect((await rpc(host, hostState, 'closeProducer', { producerId: 'screen-producer' }))?.result.closed).toBe(true);
            expect(sfuClient.closeProducer).toHaveBeenCalledWith(hostState.roomId, hostState.peerId, 'screen-producer');
            expect(sent(outsider).some(message => message.method === 'presenterChanged' && message.params.presenting === false)).toBe(true);
        } finally {
            await handlePeerDisconnect(outsiderState); await handlePeerDisconnect(hostState);
        }
    });
});

it('holds guests until the saved host starts the meeting, then knocks them when the waiting room is on', async () => {
    const { loadMeetingPolicy } = await import('../meeting-policy.js');
    vi.mocked(loadMeetingPolicy).mockResolvedValue({hostId:'owner',status:'waiting',settings:{meetingKind:'conference',waitingRoomEnabled:true,allowChat:false,allowScreenShare:true,allowRecording:false}});
    const code=`owner-${crypto.randomUUID().slice(0,10)}`;
    const guest=socket(), guestState:any={};
    try {
        expect((await rpc(guest,guestState,'joinRoom',{meetingCode:code,displayName:'Guest'}))?.result.status).toBe('waitingForHost');
        expect(roomManager.getRoom(guestState.roomId)?.peers.size).toBe(0);
        const host=socket(), hostState:any={authUser:{sub:'owner'}};
        const result=await rpc(host,hostState,'joinRoom',{meetingCode:code,displayName:'Owner'});
        expect(result?.result.role).toBe('host');
        expect(roomManager.getRoom(hostState.roomId)?.settings.allowChat).toBe(false);
        // Nobody is listed as knocking while they are only waiting for the host.
        await tick();
        expect(sent(guest).some(m => m.method === 'waitingStatus' && m.params.status === 'knocking')).toBe(true);
        expect(sent(host).some(m => m.method === 'waitingRoomPeer')).toBe(true);
        expect((await rpc(host,hostState,'getWaitingRoom'))?.result.waitingPeers).toHaveLength(1);
        expect((await rpc(host,hostState,'admitPeer',{targetPeerId:guestState.peerId}))?.result.admitted).toBe(true);
        await handlePeerDisconnect(guestState); await handlePeerDisconnect(hostState);
    } finally { vi.mocked(loadMeetingPolicy).mockResolvedValue(null); }
});

it('keeps signed-in invitees waiting after the host arrives even when saved settings disable the waiting room', async () => {
    const { loadMeetingPolicy } = await import('../meeting-policy.js');
    vi.mocked(loadMeetingPolicy).mockResolvedValue({hostId:'owner',status:'waiting',settings:{meetingKind:'conference',waitingRoomEnabled:true,allowChat:true,allowScreenShare:true,allowRecording:true}});
    const code=`auto-${crypto.randomUUID().slice(0,10)}`;
    const guest=socket(), guestState:any={authUser:{sub:'colleague'}}, host=socket(), hostState:any={authUser:{sub:'owner'}};
    try {
        expect((await rpc(guest,guestState,'joinRoom',{meetingCode:code,displayName:'Colleague'}))?.result.status).toBe('waitingForHost');
        await rpc(host,hostState,'joinRoom',{meetingCode:code,displayName:'Owner'});
        await tick();
        expect(sent(guest).some(m => m.method === 'admitted')).toBe(false);
        const room = roomManager.getRoom(hostState.roomId)!;
        expect(room.settings.waitingRoomEnabled).toBe(true);
        expect(room.peers.has(guestState.peerId)).toBe(false);
        expect(room.waitingRoom.has(guestState.peerId)).toBe(true);
        expect((await rpc(host,hostState,'admitPeer',{targetPeerId:guestState.peerId}))?.result.admitted).toBe(true);
        expect(room.peers.get(guestState.peerId)?.userId).toBe('colleague');
        await handlePeerDisconnect(guestState); await handlePeerDisconnect(hostState);
    } finally { vi.mocked(loadMeetingPolicy).mockResolvedValue(null); }
});

it('hands the host role to a co-host, then back to the owner when they return', async () => {
    const { loadMeetingPolicy } = await import('../meeting-policy.js');
    vi.mocked(loadMeetingPolicy).mockResolvedValue({hostId:'owner',status:'waiting',settings:{meetingKind:'conference',waitingRoomEnabled:true,allowChat:true,allowScreenShare:true,allowRecording:true}});
    const code=`cohost-${crypto.randomUUID().slice(0,10)}`;
    const host=socket(), hostState:any={authUser:{sub:'owner'}}, co=socket(), coState:any={};
    try {
        await rpc(host,hostState,'joinRoom',{meetingCode:code,displayName:'Owner'});
        await rpc(co,coState,'joinRoom',{meetingCode:code,displayName:'Deputy'});
        await rpc(host,hostState,'admitPeer',{targetPeerId:coState.peerId});
        await rpc(host,hostState,'changeRole',{targetPeerId:coState.peerId,newRole:'co-host'});
        await handlePeerDisconnect(hostState);
        const room = roomManager.getRoomByCode(code)!;
        expect(room.peers.get(coState.peerId)?.role).toBe('host');
        const back=socket(), backState:any={authUser:{sub:'owner'}};
        expect((await rpc(back,backState,'joinRoom',{meetingCode:code,displayName:'Owner'}))?.result.role).toBe('host');
        expect(room.peers.get(coState.peerId)?.role).toBe('co-host');
        expect(room.hostPeerId).toBe(backState.peerId);
        await handlePeerDisconnect(coState); await handlePeerDisconnect(backState);
    } finally { vi.mocked(loadMeetingPolicy).mockResolvedValue(null); }
});

it('enforces host management: mics, cameras, reactions and lowering hands', async () => {
    const code=`manage-${crypto.randomUUID().slice(0,10)}`;
    const host=socket(), hostState:any={}, guest=socket(), guestState:any={};
    await rpc(host,hostState,'joinRoom',{meetingCode:code,displayName:'Host'});
    await rpc(guest,guestState,'joinRoom',{meetingCode:code,displayName:'Guest'});
    await rpc(host,hostState,'admitPeer',{targetPeerId:guestState.peerId});
    expect((await rpc(host,hostState,'updateSettings',{settings:{allowMicrophone:false,allowCamera:false,allowReactions:false}}))?.result.updated).toBe(true);
    expect(sent(guest).filter(m => m.method === 'forceMute').map(m => m.params.kind).sort()).toEqual(['audio','video']);
    expect((await rpc(guest,guestState,'muteStateChanged',{kind:'audio',muted:false}))?.error?.message).toContain('microphones');
    expect((await rpc(guest,guestState,'muteStateChanged',{kind:'video',muted:false}))?.error?.message).toContain('cameras');
    expect((await rpc(guest,guestState,'produce',{kind:'audio',appData:{source:'mic'}}))?.error?.message).toContain('microphones');
    expect((await rpc(guest,guestState,'reaction',{emoji:'👍'}))?.error?.message).toContain('reactions');
    expect((await rpc(host,hostState,'muteStateChanged',{kind:'audio',muted:false}))?.result.ok).toBe(true);
    expect((await rpc(host,hostState,'reaction',{emoji:'👍'}))?.result.sent).toBe(true);
    await rpc(guest,guestState,'raiseHand',{raised:true});
    expect((await rpc(guest,guestState,'lowerHand',{}))?.error?.code).toBe(-32005);
    expect((await rpc(host,hostState,'lowerHand',{}))?.result.lowered).toBe(1);
    expect(roomManager.getRoom(hostState.roomId)?.peers.get(guestState.peerId)?.handRaised).toBe(false);
    expect((await rpc(host,hostState,'hostMutePeer',{targetPeerId:guestState.peerId,kind:'screen'}))?.error?.code).toBe(-32602);
    expect((await rpc(host,hostState,'hostMutePeer',{targetPeerId:guestState.peerId,kind:'video'}))?.result.muted).toBe(true);
    await rpc(host,hostState,'updateSettings',{settings:{allowMicrophone:true}});
    expect((await rpc(guest,guestState,'muteStateChanged',{kind:'audio',muted:false}))?.result.ok).toBe(true);
    await handlePeerDisconnect(guestState); await handlePeerDisconnect(hostState);
});

it('does not let hosts disable approval or remove people from the waiting room', async () => {
    const code=`quick-${crypto.randomUUID().slice(0,10)}`;
    const host=socket(), hostState:any={}, guest=socket(), guestState:any={};
    await rpc(host,hostState,'joinRoom',{meetingCode:code,displayName:'Host'});
    await rpc(host,hostState,'updateSettings',{settings:{waitingRoomEnabled:true}});
    expect((await rpc(guest,guestState,'joinRoom',{meetingCode:code,displayName:'Guest'}))?.result.status).toBe('waiting');
    expect((await rpc(host,hostState,'updateSettings',{settings:{waitingRoomEnabled:false}}))?.error?.code).toBe(-32005);
    await tick(50);
    expect(sent(guest).some(m => m.method === 'admitted')).toBe(false);
    expect(roomManager.getRoom(hostState.roomId)?.waitingRoom.has(guestState.peerId)).toBe(true);
    await handlePeerDisconnect(guestState); await handlePeerDisconnect(hostState);
});

it('requires host admission for webinar guests even when the waiting room is off and denies guest publishing', async () => {
    const { loadMeetingPolicy } = await import('../meeting-policy.js');
    vi.mocked(loadMeetingPolicy).mockResolvedValue({ hostId: 'organiser', status: 'waiting', settings: {
        webinar: true, meetingKind: 'town_hall', waitingRoomEnabled: true, allowChat: true, allowScreenShare: true, allowRecording: false,
    } });
    const code = `webinar-${crypto.randomUUID().slice(0, 10)}`;
    const host = socket(), attendee = socket(), hostState: any = { authUser: { sub: 'organiser' } }, attendeeState: any = {};
    try {
        expect((await rpc(host, hostState, 'joinRoom', { meetingCode: code, displayName: 'Organiser' }))?.result.canPublish).toBe(true);
        expect((await rpc(attendee, attendeeState, 'joinRoom', { meetingCode: code, displayName: 'Attendee' }))?.result.status).toBe('waiting');
        expect((await rpc(host, hostState, 'admitPeer', { targetPeerId: attendeeState.peerId }))?.result.admitted).toBe(true);
        expect(attendee.send.mock.calls.map(([raw]) => JSON.parse(raw)).find(message => message.method === 'admitted')?.params.canPublish).toBe(false);
        expect((await rpc(attendee, attendeeState, 'produce', { kind: 'audio' }))?.error?.message).toContain('Only the webinar organiser');
        expect((await rpc(attendee, attendeeState, 'captionPublish', {}))?.error?.message).toContain('Only the webinar organiser');
    } finally {
        await handlePeerDisconnect(attendeeState);
        await handlePeerDisconnect(hostState);
        vi.mocked(loadMeetingPolicy).mockResolvedValue(null);
    }
});

it('keeps valid invitation links in the same queue until host approval and reports when they stay waiting', async () => {
    const { loadMeetingPolicy } = await import('../meeting-policy.js');
    const code = `invite-${crypto.randomUUID().slice(0, 10)}`;
    vi.mocked(loadMeetingPolicy).mockResolvedValue({ hostId: 'owner', status: 'waiting', settings: { meetingKind: 'conference', waitingRoomEnabled: true, allowChat: true, allowScreenShare: true, allowRecording: true } });
    const host = socket(), hostState: any = { authUser: { sub: 'owner' } };
    const invited = socket(), invitedState: any = { authUser: { sub: 'invitee' } };
    const inviteToken = meetingInvitation.createMeetingInviteToken(code);
    try {
        await rpc(host, hostState, 'joinRoom', { meetingCode: code, displayName: 'Owner' });
        const join = await rpc(invited, invitedState, 'joinRoom', { meetingCode: code, displayName: 'Invitee', inviteToken });
        expect(join?.result.status).toBe('waiting');
        expect(roomManager.getRoom(hostState.roomId)?.peers.has(invitedState.peerId)).toBe(false);
        const waiting = (await rpc(host, hostState, 'getWaitingRoom'))?.result.waitingPeers[0];
        expect(waiting).toMatchObject({ peerId: invitedState.peerId, invited: true, reviewed: false });
        expect((await rpc(host, hostState, 'keepWaiting', { targetPeerId: invitedState.peerId }))?.result.keptWaiting).toBe(true);
        expect(sent(invited).some(message => message.method === 'waitingStatus' && message.params.status === 'keptWaiting')).toBe(true);
        expect((await rpc(host, hostState, 'getWaitingRoom'))?.result.waitingPeers[0]).toMatchObject({ invited: true, reviewed: true });
        expect((await rpc(host, hostState, 'admitPeer', { targetPeerId: invitedState.peerId }))?.result.admitted).toBe(true);
    } finally {
        await handlePeerDisconnect(invitedState); await handlePeerDisconnect(hostState);
        vi.mocked(loadMeetingPolicy).mockResolvedValue(null);
    }
});

it('caps co-hosts at five under simultaneous promotion requests', async () => {
    const code = `cohost-limit-${crypto.randomUUID().slice(0, 8)}`;
    const host = socket(), hostState: any = {};
    await rpc(host, hostState, 'joinRoom', { meetingCode: code, displayName: 'Host' });
    const people = await Promise.all(Array.from({ length: 6 }, async (_, index) => {
        const ws = socket(), state: any = {};
        await rpc(ws, state, 'joinRoom', { meetingCode: code, displayName: `Person ${index + 1}` });
        await rpc(host, hostState, 'admitPeer', { targetPeerId: state.peerId });
        return { ws, state };
    }));
    const outcomes = await Promise.all(people.map(({ state }) => rpc(host, hostState, 'changeRole', { targetPeerId: state.peerId, newRole: 'co-host' })));
    expect(outcomes.filter(outcome => outcome?.result?.changed)).toHaveLength(5);
    expect(outcomes.filter(outcome => outcome?.error?.message?.includes('up to 5 co-hosts'))).toHaveLength(1);
    const room = roomManager.getRoom(hostState.roomId)!;
    expect([...room.peers.values()].filter(peer => peer.role === 'host')).toHaveLength(1);
    expect([...room.peers.values()].filter(peer => peer.role === 'co-host')).toHaveLength(5);
    const remaining = people.find(({ state }) => room.peers.get(state.peerId)?.role === 'member')!;
    const coHost = people.find(({ state }) => room.peers.get(state.peerId)?.role === 'co-host')!;
    await rpc(host, hostState, 'changeRole', { targetPeerId: coHost.state.peerId, newRole: 'member' });
    expect((await rpc(host, hostState, 'changeRole', { targetPeerId: remaining.state.peerId, newRole: 'co-host' }))?.result.changed).toBe(true);
    for (const { state } of people.reverse()) await handlePeerDisconnect(state);
    await handlePeerDisconnect(hostState);
});

it('keeps one host when the signed-in owner returns after a platform administrator', async () => {
    const { loadMeetingPolicy } = await import('../meeting-policy.js');
    const code = `single-host-${crypto.randomUUID().slice(0, 8)}`;
    vi.mocked(loadMeetingPolicy).mockResolvedValue({ hostId: 'owner', status: 'waiting', settings: { meetingKind: 'conference', waitingRoomEnabled: true, allowChat: true, allowScreenShare: true, allowRecording: true } });
    const admin = socket(), adminState: any = { authUser: { sub: 'admin', role: 'admin' } };
    const owner = socket(), ownerState: any = { authUser: { sub: 'owner' } };
    try {
        await rpc(admin, adminState, 'joinRoom', { meetingCode: code, displayName: 'Admin' });
        await rpc(owner, ownerState, 'joinRoom', { meetingCode: code, displayName: 'Owner' });
        const room = roomManager.getRoomByCode(code)!;
        expect(room.hostPeerId).toBe(ownerState.peerId);
        expect([...room.peers.values()].filter(peer => peer.role === 'host').map(peer => peer.id)).toEqual([ownerState.peerId]);
        expect(room.peers.get(adminState.peerId)?.role).toBe('co-host');
    } finally {
        await handlePeerDisconnect(ownerState); await handlePeerDisconnect(adminState);
        vi.mocked(loadMeetingPolicy).mockResolvedValue(null);
    }
});

it('spotlights for everyone, tracks presenters and clears both when people leave', async () => {
    const code=`spot-${crypto.randomUUID().slice(0,10)}`;
    const host=socket(), hostState:any={}, guest=socket(), guestState:any={};
    await rpc(host,hostState,'joinRoom',{meetingCode:code,displayName:'Host'});
    await rpc(guest,guestState,'joinRoom',{meetingCode:code,displayName:'Guest'});
    await rpc(host,hostState,'admitPeer',{targetPeerId:guestState.peerId});
    expect((await rpc(guest,guestState,'setSpotlight',{targetPeerId:hostState.peerId}))?.error?.code).toBe(-32005);
    expect((await rpc(host,hostState,'setSpotlight',{targetPeerId:'nobody'}))?.error?.code).toBe(-32602);
    expect((await rpc(host,hostState,'setSpotlight',{targetPeerId:guestState.peerId}))?.result.spotlightPeerId).toBe(guestState.peerId);
    expect(sent(guest).some(m => m.method === 'spotlightChanged' && m.params.peerId === guestState.peerId)).toBe(true);
    await rpc(guest,guestState,'muteStateChanged',{kind:'screen',muted:true,presenting:true});
    const room = roomManager.getRoom(hostState.roomId)!;
    expect(room.peers.get(guestState.peerId)?.screenSharing).toBe(true);
    expect(sent(host).some(m => m.method === 'presenterChanged' && m.params.presenting)).toBe(true);
    const late=socket(), lateState:any={};
    const joined = await rpc(late,lateState,'joinRoom',{meetingCode:code,displayName:'Late'});
    expect(joined?.result.status).toBe('waiting');
    await rpc(host,hostState,'admitPeer',{targetPeerId:lateState.peerId});
    const lateJoin = sent(late).find(message => message.method === 'admitted')?.params;
    expect(lateJoin?.spotlightPeerId).toBe(guestState.peerId);
    expect(lateJoin?.existingPeers.find((p: any) => p.peerId === guestState.peerId).screenSharing).toBe(true);
    await rpc(host,hostState,'updateSettings',{settings:{allowScreenShare:false}});
    expect((await rpc(late,lateState,'muteStateChanged',{kind:'screen',muted:true,presenting:true}))?.error?.message).toContain('disabled');
    await handlePeerDisconnect(guestState);
    expect(room.spotlightPeerId).toBeNull();
    await handlePeerDisconnect(lateState); await handlePeerDisconnect(hostState);
});

it('lets webinar hosts invite attendees on stage, and removes their media when taken off stage', async () => {
    const { loadMeetingPolicy } = await import('../meeting-policy.js');
    vi.mocked(loadMeetingPolicy).mockResolvedValue({ hostId: 'organiser', status: 'waiting', settings: { webinar: true, meetingKind: 'town_hall', waitingRoomEnabled: true, allowChat: true, allowScreenShare: true, allowRecording: false } });
    const code = `stage-${crypto.randomUUID().slice(0, 10)}`;
    const host = socket(), attendee = socket(), hostState: any = { authUser: { sub: 'organiser' } }, attendeeState: any = {};
    try {
        await rpc(host, hostState, 'joinRoom', { meetingCode: code, displayName: 'Organiser' });
        await rpc(attendee, attendeeState, 'joinRoom', { meetingCode: code, displayName: 'Attendee' });
        await rpc(host, hostState, 'admitPeer', { targetPeerId: attendeeState.peerId });
        expect((await rpc(attendee, attendeeState, 'produce', { kind: 'audio' }))?.error?.message).toContain('Only the webinar organiser');
        expect((await rpc(attendee, attendeeState, 'setStage', { targetPeerId: attendeeState.peerId, onStage: true }))?.error?.code).toBe(-32005);
        expect((await rpc(host, hostState, 'setStage', { targetPeerId: attendeeState.peerId, onStage: true }))?.result.onStage).toBe(true);
        expect(sent(attendee).find(m => m.method === 'stageChanged')?.params.canPublish).toBe(true);
        expect((await rpc(attendee, attendeeState, 'produce', { kind: 'audio' }))?.error?.message ?? '').not.toContain('Only the webinar organiser');
        await rpc(host, hostState, 'setStage', { targetPeerId: attendeeState.peerId, onStage: false });
        expect(sent(attendee).filter(m => m.method === 'forceMute' && m.params.reason === 'stage')).toHaveLength(2);
        expect((await rpc(attendee, attendeeState, 'produce', { kind: 'audio' }))?.error?.message).toContain('Only the webinar organiser');
    } finally {
        await handlePeerDisconnect(attendeeState); await handlePeerDisconnect(hostState);
        vi.mocked(loadMeetingPolicy).mockResolvedValue(null);
    }
});

it('scopes Poly snapshots and admission to the joined room and hides lobby data from attendees', async () => {
    const { sfuClient } = await import('../sfu-client.js');
    vi.stubEnv('POLY_BRIDGE_ENABLED', 'true');
    const host = socket(), guest = socket();
    const hostState: any = {}, guestState: any = {};
    const meetingCode = `poly-${crypto.randomUUID().slice(0, 10)}`;
    try {
        expect((await rpc(guest, guestState, 'polySnapshot'))?.error?.code).toBe(-32000);
        await rpc(host, hostState, 'joinRoom', { meetingCode, displayName: 'Host' });
        await rpc(guest, guestState, 'joinRoom', { meetingCode, displayName: 'Guest' });
        await rpc(host, hostState, 'admitPeer', { targetPeerId: guestState.peerId });
        expect((await rpc(guest, guestState, 'polySnapshot', { roomId: 'other' }))?.result).toEqual({
            producers: [{ producerId: 'composite' }], roster: [{ callId: 'member' }], lobby: [],
        });
        expect(sfuClient.polySnapshot).toHaveBeenLastCalledWith(guestState.roomId);
        expect((await rpc(host, hostState, 'polySnapshot'))?.result.lobby).toEqual([{ callId: 'waiting' }]);
        expect((await rpc(guest, guestState, 'admitPeer', { targetPeerId: 'poly:waiting' }))?.error?.code).toBe(-32005);
        expect((await rpc(host, hostState, 'admitPeer', { targetPeerId: 'poly:waiting' }))?.result.admitted).toBe(true);
        expect(sfuClient.polyLobbyAction).toHaveBeenLastCalledWith(hostState.roomId, 'waiting', 'admit');
    } finally {
        await handlePeerDisconnect(guestState);
        await handlePeerDisconnect(hostState);
        vi.unstubAllEnvs();
    }
});

it('lets only the signed-in meeting host enable the room-device bridge', async () => {
    const { sfuClient } = await import('../sfu-client.js');
    vi.stubEnv('POLY_BRIDGE_ENABLED', 'true');
    const host = socket(), guest = socket();
    const hostState: any = { authUser: { sub: 'owner' } }, guestState: any = {};
    const meetingCode = `mcu-${crypto.randomUUID().slice(0, 10)}`;
    try {
        await rpc(host, hostState, 'joinRoom', { meetingCode, displayName: 'Host' });
        await rpc(guest, guestState, 'joinRoom', { meetingCode, displayName: 'Guest' });
        await rpc(host, hostState, 'admitPeer', { targetPeerId: guestState.peerId });
        expect((await rpc(guest, guestState, 'startPolyRoom'))?.error?.code).toBe(-32005);
        expect((await rpc(host, hostState, 'startPolyRoom'))?.result).toEqual({ roomAlias: hostState.roomId });
        expect(sfuClient.startPolyRoom).toHaveBeenLastCalledWith(hostState.roomId);
        vi.mocked(sfuClient.startPolyRoom).mockRejectedValueOnce(new Error('internal endpoint'));
        expect((await rpc(host, hostState, 'startPolyRoom'))?.error?.message).toContain('could not start');
    } finally {
        await handlePeerDisconnect(guestState);
        await handlePeerDisconnect(hostState);
        vi.unstubAllEnvs();
    }
});
