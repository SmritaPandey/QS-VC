import { bharatVcDial, disconnectBharatVc } from '../bharat-vc.js';
import { recordMeetingAttendance } from '../meeting-attendance.js';
import { meetingObservability } from '../meeting-observability.js';
import { admittedPeerIceServers } from '../turn.js';
import { loadMeetingPolicy, reportMeetingStatus, endHostedMeetingStatus, verifySignalingAccess } from '../meeting-policy.js';
/**
 * JSON-RPC 2.0 Method Handler for QS-VC Signaling.
 *
 * Handles all client↔server signaling messages for WebRTC negotiation,
 * waiting room, host controls, RBAC, and media stats.
 */
import { encryptedQuestionsRpc } from '../encrypted-questions.js';
import { encryptedPollRpc } from '../encrypted-polls.js';
import { encryptedBoardRpc } from '../encrypted-board.js';
import { collaborationRpc } from '../collaboration.js';
import { sfuClient } from '../sfu-client.js';
import { roomManager, PeerState, PeerRole, type PrivateConversation, type VerifiedSignalingUser, type RoomState, type WaitingPeer } from '../room-manager.js';
import { logger } from '../logger.js';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { can, getPrivateConversationLimitMs } from '../../../../shared/entitlements.cjs';
import meetingInvitation from '../../../../shared/meeting-invitation.cjs';
import { publishCaption, publishInterim, subscribeCaptions, translationCapabilities, translateCaption, clearEmptyRoomCaptions, forgetPeerCaptions, setTranscriptSaving, transcriptEntries } from '../captions.js';
import { asrParticipants, asrCapabilities, pushAsrAudio, startAsr, stopAsr, stopAsrForPeer } from '../asr-relay.js';
import { askOpenRouter, openRouterConfigured } from '../openrouter.js';
import { generateMinutes, minutesConfigured } from '../minutes.js';
import { generateMeetingSummary } from '../ai-meeting-summary.js';
import { saveTranscript } from '../transcript-store.js';

const { createMeetingInviteToken, verifyMeetingInviteToken, isSessionMeetingCode, verifySessionMeetingInvite, verifyGuestHostToken } = meetingInvitation;
const endingRooms = new WeakSet<object>();
const roomTeardowns = new WeakMap<object, Promise<void>>();
const dashboardControls = new WeakMap<object, { sub: string; tenantId: string; action: 'end' | 'cancel'; promise: Promise<void> }>();
const cancelledRooms = new WeakSet<object>();
const endedCodes = new Map<string, number>();
const startedSessionCodes = new Map<string, number>();
const sessionInviteExpirations = new WeakMap<RoomState, number>();
const assistantBudgets = new Map<string, { until: number; count: number; pending: boolean }>();
const endedCodeCleanup = setInterval(() => {
    const now = Date.now();
    for (const [account, budget] of assistantBudgets) {
        if (!budget.pending && budget.until <= now) assistantBudgets.delete(account);
    }
    for (const codes of [endedCodes, startedSessionCodes]) {
        for (const [code, expiry] of codes) if (expiry <= now) codes.delete(code);
    }
}, 60_000);
endedCodeCleanup.unref();
const roomEpochs = new WeakMap<object, number>();
const closingBreakouts = new WeakSet<RoomState>();
const movingBreakoutPeers = new Set<string>();
const detachedBreakoutPeers = new WeakSet<PeerState>();
const pendingVideoSources = new WeakMap<object, Map<string, Set<string>>>();
const roomIsEnding = (room: object) => endingRooms.has(room) || dashboardControls.has(room);
const admittingPeers = new Set<string>();
const relayConfigurations = new WeakMap<object, { until: number; request: ReturnType<typeof admittedPeerIceServers> }>();
function canManagePeer(roomId: string, actorId: string, targetId: string): boolean {
    const room = roomManager.getRoom(roomId), actor = room?.peers.get(actorId), target = room?.peers.get(targetId);
    return !!actor && !!target && actorId !== targetId && target.role !== 'host' &&
        (actor.role === 'host' || (actor.role === 'co-host' && target.role !== 'co-host'));
}
/** Hosts and co-hosts bypass participant mic and camera restrictions. */
function isManager(peer?: PeerState): boolean {
    return peer?.role === 'host' || peer?.role === 'co-host';
}
async function stopRestrictedScreenShare(roomId: string, peer: PeerState) {
    const isScreen = (producer: { appData: any }) => producer.appData?.type === 'screen' || producer.appData?.source === 'screen';
    const screens = [...peer.producers.values()].filter(isScreen);
    if (!peer.screenSharing && !screens.length) return;
    roomManager.sendToPeer(roomId, peer.id, 'stopPresenting', { by: 'The host' });
    await Promise.all(screens.map(async producer => {
        try {
            await sfuClient.closeProducer(roomId, peer.id, producer.id);
            if (peer.producers.delete(producer.id)) roomManager.broadcast(roomId, 'producerClosed', { peerId: peer.id, producerId: producer.id, kind: producer.kind });
        } catch (error) {
            await sfuClient.setProducerPaused(roomId, peer.id, producer.id, true).catch(() => logger.warn(error, 'Could not stop a restricted presentation'));
        }
    }));
    if ([...peer.producers.values()].some(producer => !screens.includes(producer) && isScreen(producer))) return;
    peer.screenSharing = false;
    roomManager.broadcast(roomId, 'presenterChanged', { peerId: peer.id, displayName: peer.displayName, presenting: false });
}
/** Webinars: only the organiser, hosts/co-hosts and people invited on stage may send media or captions. */
function canPublishInRoom(roomId: string, peerId: string, authSub?: string): boolean {
    const room = roomManager.getRoom(roomId);
    if (!room) return false;
    if (!room.settings.webinar) return true;
    const peer = room.peers.get(peerId);
    return (!!room.ownerUserId && room.ownerUserId === authSub) || isManager(peer) || room.stage.has(peerId);
}
const PERMISSION_MESSAGES = {
    audio: 'The host has turned off microphones for participants.',
    video: 'The host has turned off cameras for participants.',
} as const;

function canEnterWithoutApproval(room: RoomState, user?: VerifiedSignalingUser | null, guest?: boolean): boolean {
    return !!user?.sub && !guest && !room.removedUserIds.has(user.sub);
}

/** Release signed-in attendees and show guest requests to the meeting managers. */
async function releaseAwaitingHost(roomId: string): Promise<void> {
    const room = roomManager.getRoom(roomId);
    if (!room?.hostStarted) return;
    const signedIn: WaitingPeer[] = [];
    for (const waiting of room.waitingRoom.values()) {
        if (!waiting.awaitingHost) continue;
        if (canEnterWithoutApproval(room, waiting.authUser, waiting.isGuest)) {
            signedIn.push(waiting);
            continue;
        }
        waiting.awaitingHost = false;
        roomManager.sendToSocket(waiting.ws, 'waitingStatus', { status: 'knocking' }, waiting.id);
        for (const peer of room.peers.values()) {
            if (isManager(peer)) roomManager.sendToPeer(roomId, peer.id, 'waitingRoomPeer', {
                peerId: waiting.id, displayName: waiting.displayName, invited: waiting.invited, isGuest: waiting.isGuest,
            });
        }
    }
    // Each entrant opens two transports. Batch the release to avoid flooding the SFU.
    for (let i = 0; i < signedIn.length && room.hostStarted; i += 8) {
        await Promise.all(signedIn.slice(i, i + 8).map(async waiting => {
            if (room.waitingRoom.get(waiting.id) !== waiting || !waiting.awaitingHost) return;
            waiting.awaitingHost = false;
            try {
                await admitWaitingPeer(roomId, waiting.id, true);
            } catch (error) {
                if (room.waitingRoom.get(waiting.id) !== waiting || waiting.awaitingHost) return;
                room.waitingRoom.delete(waiting.id);
                roomManager.sendToSocket(waiting.ws, 'rejected', { reason: error instanceof Error ? error.message : 'Could not join. Try again.' }, waiting.id);
            }
        }));
    }
}

async function admitWaitingPeer(roomId: string, targetId: string, automatic = false) {
    const room = roomManager.getRoom(roomId), waiting = room?.waitingRoom.get(targetId);
    if (!room || !waiting || waiting.awaitingHost) throw createError(-32000, 'Peer is not waiting for admission');
    if (admittingPeers.has(targetId)) throw createError(-32000, 'Admission already in progress');
    admittingPeers.add(targetId);
    try {
        const result = await joinPeerToRoom(waiting.ws, roomId, waiting.id, waiting.displayName, waiting.rtpCapabilities, { authUser: waiting.authUser, siteLocation: waiting.siteLocation }, null,
            () => {
                if (waiting.inviteExpiresAt !== undefined && Date.now() >= waiting.inviteExpiresAt) {
                    throw createError(-32005, 'This meeting invitation has expired. Ask the organiser for a valid link.');
                }
                if (automatic && room.settings.password && room.settings.password !== waiting.checkedPassword) {
                    throw createError(-32001, 'Invalid meeting password');
                }
                if (room.waitingRoom.get(targetId) !== waiting || waiting.awaitingHost ||
                    (automatic && (!room.hostStarted || !canEnterWithoutApproval(room, waiting.authUser, waiting.isGuest)))) {
                    throw createError(-32000, 'Admission cancelled');
                }
            },
            waiting.isGuest ? 'guest' : waiting.initialRole);
        room.waitingRoom.delete(targetId);
        if (waiting.authUser?.sub) room.removedUserIds.delete(waiting.authUser.sub);
        roomManager.sendToSocket(waiting.ws, 'admitted', result?.result || {}, waiting.id);
        return result;
    } finally { admittingPeers.delete(targetId); }
}

function breakoutParent(room: RoomState): RoomState {
    const parent = room.parentRoomId ? roomManager.getRoom(room.parentRoomId) : room;
    if (!parent) throw createError(-32000, 'The main meeting is no longer available.');
    return parent;
}

function breakoutState(parent: RoomState, peerId: string) {
    const manage = parent.hostPeerId === peerId;
    const rooms = [...(parent.breakoutRooms?.values() || [])].filter(child => manage || child.assignedPeerIds.has(peerId));
    return { mainRoomId: parent.id, mainMeetingCode: parent.meetingCode, rooms: rooms.map(child => ({ roomId: child.roomId, name: child.name, open: child.open, ...(manage ? { assignedPeerIds: [...child.assignedPeerIds] } : {}) })) };
}

function publishBreakouts(parent: RoomState) {
    const recipients = new Map(parent.peers);
    for (const child of parent.breakoutRooms?.values() || []) {
        for (const [id, peer] of roomManager.getRoom(child.roomId)?.peers || []) recipients.set(id, peer);
    }
    for (const [id, peer] of recipients) roomManager.sendToSocket(peer.ws, 'breakoutRoomsUpdated', breakoutState(parent, id), id);
}

// Input sanitization helpers
function sanitizeString(s: string, maxLen = 100): string {
    return s.trim().replace(/<[^>]*>/g, '').slice(0, maxLen);
}

function sanitizeChat(s: string): string {
    return s.trim()
        .replace(/<script[^>]*>.*?<\/script>/gi, '')
        .slice(0, 4096);
}

function conversationHasPeer(session: PrivateConversation, peerId: string): boolean {
    return session.initiatorPeerId === peerId || session.targetPeerId === peerId;
}

async function setPublicMicPaused(roomId: string, peer: PeerState, paused: boolean): Promise<void> {
    const publicMics = [...peer.producers.values()].filter(producer =>
        producer.kind === 'audio' && producer.appData?.source === 'mic' && producer.appData?.type !== 'private-audio');
    for (const producer of publicMics) {
        await sfuClient.setProducerPaused(roomId, peer.id, producer.id, paused);
    }
}

async function finishPrivateConversation(roomId: string, conversationId: string, reason: string, byPeerId?: string): Promise<boolean> {
    const room = roomManager.getRoom(roomId);
    const session = room?.privateConversations.get(conversationId);
    if (!room || !session) return false;
    // Delete synchronously before awaits to make timeout, disconnect and end requests idempotent.
    room.privateConversations.delete(conversationId);
    if (session.timer) clearTimeout(session.timer);

    for (const participantId of [session.initiatorPeerId, session.targetPeerId]) {
        const participant = room.peers.get(participantId);
        if (!participant) continue;
        for (const producer of [...participant.producers.values()]) {
            if (producer.appData?.type !== 'private-audio' || producer.appData?.conversationId !== conversationId) continue;
            await sfuClient.closeProducer(roomId, participantId, producer.id).catch(error => logger.warn(error, 'Could not close private conversation producer'));
            participant.producers.delete(producer.id);
        }
        if (session.status === 'active') {
            const wasMuted = session.previousAudioMuted?.[participantId] ?? participant.audioMuted;
            participant.audioMuted = wasMuted;
            await setPublicMicPaused(roomId, participant, wasMuted).catch(error => logger.warn(error, 'Could not restore meeting microphone state'));
            roomManager.broadcast(roomId, 'peerMuteChanged', {
                peerId: participantId,
                displayName: participant.displayName,
                kind: 'audio',
                muted: wasMuted,
            }, participantId);
        }
    }
    for (const participantId of [session.initiatorPeerId, session.targetPeerId]) {
        roomManager.sendToPeer(roomId, participantId, 'privateConversationEnded', {
            conversationId,
            reason,
            byPeerId: byPeerId || null,
        });
    }
    return true;
}

async function finishPrivateConversationsForPeer(roomId: string, peerId: string, reason: string): Promise<void> {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    const sessions = [...room.privateConversations.values()].filter(session => conversationHasPeer(session, peerId));
    for (const session of sessions) await finishPrivateConversation(roomId, session.id, reason, peerId);
}

// RPC param validation schemas
const roomSettingsSchema = z.object({
    maxParticipants: z.number().int().min(1).max(1000).optional(),
    waitingRoomEnabled: z.boolean().optional(), locked: z.boolean().optional(),
    password: z.string().max(50).nullable().optional(), muteOnEntry: z.boolean().optional(),
    allowScreenShare: z.boolean().optional(), allowFileShare: z.boolean().optional(), allowChat: z.boolean().optional(),
    allowRecording: z.boolean().optional(),
    allowMicrophone: z.boolean().optional(), allowCamera: z.boolean().optional(),
    allowReactions: z.boolean().optional(),
}).strict();
const waitingPeerSchema = z.object({ targetPeerId: z.string().min(1).max(128) }).strict();
const privateConversationStartSchema = z.object({ targetPeerId: z.string().min(1).max(128) }).strict();
const privateConversationIdSchema = z.object({ conversationId: z.string().min(1).max(128) }).strict();
const closeProducerSchema = z.object({ producerId: z.string().min(1).max(128) }).strict();

const joinRoomSchema = z.object({
    meetingCode: z.string().min(1).max(30),
    displayName: z.string().min(1).max(100),
    siteLocation: z.string().trim().max(120).optional(),
    inviteToken: z.string().max(512).optional(),
    guestToken: z.string().max(128).optional(),
    guestHostToken: z.string().max(43).optional(),
    rtpCapabilities: z.record(z.string(), z.unknown()).optional(),
    password: z.string().max(50).optional(),
    role: z.enum(['host', 'co-host', 'participant']).optional(),
    supportsE2EE: z.boolean().optional(),
});

const chatMessageSchema = z.object({
    content: z.string().min(1).max(4096),
    type: z.enum(['text', 'file', 'system']).optional(),
});

interface RpcRequest {
    jsonrpc: '2.0';
    method: string;
    id?: number | string;
    params?: any;
}

interface RpcResponse {
    jsonrpc: '2.0';
    id: number | string;
    result?: any;
    error?: { code: number; message: string; data?: any };
}

async function endRoomForEveryone(roomId: string, by: string, peerId?: string, action: 'end' | 'cancel' = 'end'): Promise<void> {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    const existing = roomTeardowns.get(room);
    if (existing) return existing;
    endingRooms.add(room);
    if (action === 'cancel') cancelledRooms.add(room);
    if (action === 'end' && !room.parentRoomId) {
        const code = room.meetingCode.trim().toUpperCase();
        startedSessionCodes.delete(code);
        endedCodes.set(code, sessionInviteExpirations.get(room) ?? Date.now() + 86_400_000);
    }
    roomEpochs.set(room, (roomEpochs.get(room) || 0) + 1);
    const reason = action === 'cancel' ? 'Host cancelled the meeting' : 'Host ended the meeting';
    const closeReason = action === 'cancel' ? 'Meeting cancelled' : 'Meeting ended';
    const teardown = (async () => {
        roomManager.updateRecording(roomId, null);
        if (process.env.POLY_BRIDGE_ENABLED === 'true') {
            await sfuClient.stopPolyRoom(roomId).catch(error => logger.warn(error, 'Poly bridge stop failed'));
        }
        roomManager.broadcast(roomId, 'meetingEnded', { by, reason });
        for (const session of [...room.privateConversations.values()]) {
            await finishPrivateConversation(roomId, session.id, 'meeting-ended', peerId);
        }
        for (const [pid, p] of room.peers) {
            await sfuClient.removePeer(roomId, pid).catch(() => { });
            if (p.ws && p.ws.readyState === 1) p.ws.close(4000, closeReason);
        }
        meetingObservability.ended(roomId);
        for (const child of room.breakoutRooms?.values() || []) await endRoomForEveryone(child.roomId, by, peerId, action);
        room.breakoutParticipants?.clear();
        room.breakoutRooms?.clear();
        room.peers.clear();
        room.hostPeerId = null;
        room.hostStarted = false;
        room.removedUserIds.clear();
        for (const waiting of room.waitingRoom.values()) {
            if (waiting.ws?.readyState === 1) {
                roomManager.sendToSocket(waiting.ws, 'rejected', { reason }, waiting.id);
                waiting.ws.close(4000, closeReason);
            }
        }
        room.waitingRoom.clear();
    })();
    roomTeardowns.set(room, teardown);
    try { await teardown; } finally {
        roomTeardowns.delete(room);
        endingRooms.delete(room);
    }
}

const joiningSockets = new WeakSet<object>();
const CAPTION_SPEAKER_PLAN_MESSAGE = 'Sign in with a plan that includes captions to share your speech';

/**
 * Handle a JSON-RPC request from a WebSocket client.
 */
export async function handleRpcMessage(
    ws: any,
    message: RpcRequest,
    connectionState: { peerId?: string; roomId?: string; displayName?: string; authUser?: VerifiedSignalingUser | null; expectedMeetingCode?: string; joinAttempts?: number; siteLocation?: string; mainRoomId?: string }
): Promise<RpcResponse | null> {
    const { method, params, id } = message;

    // Waiting, removed and stale connections must not act as active participants.
    if (method !== 'joinRoom' && method !== 'leaveRoom' && method !== 'endHostedMeeting') {
        const peer = roomManager.getRoom(connectionState.roomId || '')?.peers.get(connectionState.peerId || '');
        if (!peer || peer.ws !== ws) {
            return { jsonrpc: '2.0', id: id!, error: { code: -32000, message: 'Not joined a room' } };
        }
        const activeRoom = roomManager.getRoom(connectionState.roomId!);
        const child = activeRoom?.parentRoomId ? roomManager.getRoom(activeRoom.parentRoomId)?.breakoutRooms?.get(activeRoom.id) : undefined;
        if (activeRoom?.parentRoomId && !child?.open && !['joinBreakoutRoom', 'getBreakoutRooms'].includes(method)) {
            return { jsonrpc: '2.0', id: id!, error: { code: -32004, message: 'This breakout is closed. Return to the main meeting.' } };
        }
    }

    if (method === 'joinRoom' && joiningSockets.has(ws)) {
        return { jsonrpc: '2.0', id: id!, error: { code: -32000, message: 'Join already in progress' } };
    }
    if (method === 'joinRoom') {
        if ((connectionState.joinAttempts || 0) >= 5) return { jsonrpc: '2.0', id: id!, error: { code: -32003, message: 'Too many meeting join attempts on this connection' } };
        connectionState.joinAttempts = (connectionState.joinAttempts || 0) + 1;
        joiningSockets.add(ws);
    }
    try {
        switch (method) {
            case 'meetingDiagnosticsSample': {
                return { jsonrpc: '2.0', id: id!, result: meetingObservability.sample(connectionState.roomId!, connectionState.peerId!, params) };
            }
            case 'getMeetingDiagnostics': {
                return { jsonrpc: '2.0', id: id!, result: meetingObservability.report(connectionState.roomId!, connectionState.peerId!, connectionState.authUser?.sub) };
            }
            case 'liveStreamState': {
                const parsed = z.object({ active: z.boolean(), provider: z.enum(['youtube', 'facebook', 'custom']).optional() }).strict().safeParse(params);
                if (!parsed.success) throw createError(-32602, 'Invalid live-stream state.');
                const room = roomManager.getRoom(connectionState.roomId!)!;
                if (room.hostPeerId !== connectionState.peerId || !connectionState.authUser?.sub) throw createError(-32005, 'Only the signed-in host can control live streaming.');
                if (parsed.data.active && room.settings.e2eeRequired) throw createError(-32005, 'Live streaming is unavailable in an end-to-end encrypted meeting.');
                roomManager.updateLiveStream(room.id, parsed.data.active ? { active: true, provider: parsed.data.provider || 'custom', displayName: connectionState.displayName || 'Host', peerId: connectionState.peerId! } : null);
                return { jsonrpc: '2.0', id: id!, result: { notified: true } };
            }
            case 'getBreakoutRooms':
            case 'createBreakoutRoom':
            case 'assignBreakoutParticipants':
            case 'openBreakoutRooms':
            case 'closeBreakoutRooms': {
                const current = roomManager.getRoom(connectionState.roomId!)!;
                const parent = breakoutParent(current);
                const actorId = connectionState.peerId!;
                if (method === 'getBreakoutRooms') return { jsonrpc: '2.0', id: id!, result: breakoutState(parent, actorId) };
                const actor = parent.peers.get(actorId) || parent.breakoutParticipants?.get(actorId);
                if (parent.hostPeerId !== actorId || actor?.role !== 'host' || actor.ws !== ws || !actor.userId) throw createError(-32005, 'Only the signed-in main-meeting host can manage breakouts.');
                if (closingBreakouts.has(parent)) throw createError(-32004, 'Wait for breakout rooms to close.');
                parent.breakoutRooms ||= new Map();
                parent.breakoutParticipants ||= new Map();
                if (method === 'createBreakoutRoom') {
                    const parsed = z.object({ name: z.string().trim().min(1).max(60) }).strict().safeParse(params);
                    if (!parsed.success || !sanitizeString(parsed.data.name, 60)) throw createError(-32602, 'Enter a breakout name.');
                    if (parent.breakoutRooms.size >= 20) throw createError(-32004, 'This meeting already has twenty breakout rooms.');
                    const child = roomManager.getOrCreateRoom(`B-${uuidv4().replace(/-/g, '').slice(0, 20)}`, { ...parent.settings, locked: false, password: null, webinar: false, meetingKind: 'conference', allowRecording: false });
                    child.parentRoomId = parent.id;
                    child.ownerUserId = `breakout:${parent.id}`;
                    child.hostStarted = true;
                    parent.breakoutRooms.set(child.id, { roomId: child.id, name: sanitizeString(parsed.data.name, 60), open: false, assignedPeerIds: new Set() });
                } else if (method === 'assignBreakoutParticipants') {
                    const parsed = z.object({ breakoutRoomId: z.string().uuid(), peerIds: z.array(z.string().uuid()).max(parent.settings.maxParticipants) }).strict().safeParse(params);
                    if (!parsed.success) throw createError(-32602, 'Invalid breakout assignment.');
                    const child = parent.breakoutRooms.get(parsed.data.breakoutRoomId);
                    if (!child) throw createError(-32602, 'Breakout not found in this meeting.');
                    if ([...parent.breakoutRooms.values()].some(room => room.open)) throw createError(-32004, 'Close breakout rooms before changing assignments.');
                    if (new Set(parsed.data.peerIds).size !== parsed.data.peerIds.length || parsed.data.peerIds.some(peerId => !parent.peers.has(peerId))) throw createError(-32602, 'Choose admitted participants from this meeting.');
                    for (const other of parent.breakoutRooms.values()) for (const peerId of parsed.data.peerIds) other.assignedPeerIds.delete(peerId);
                    child.assignedPeerIds = new Set(parsed.data.peerIds);
                } else if (method === 'openBreakoutRooms') {
                    for (const child of parent.breakoutRooms.values()) child.open = true;
                } else {
                    closingBreakouts.add(parent);
                    try {
                        for (const child of parent.breakoutRooms.values()) child.open = false;
                        for (const child of parent.breakoutRooms.values()) {
                            const room = roomManager.getRoom(child.roomId);
                            for (const peer of room?.peers.values() || []) {
                                // Remove the old SFU session before requesting a client return; ignored notices cannot keep media flowing.
                                try { await sfuClient.removePeer(child.roomId, peer.id); detachedBreakoutPeers.add(peer); }
                                catch { peer.ws?.close(4000, 'Breakout closed. Rejoin the main meeting.'); }
                                roomManager.sendToSocket(peer.ws, 'breakoutReturnRequired', { mainRoomId: parent.id, mainMeetingCode: parent.meetingCode }, peer.id);
                            }
                        }
                    } finally { closingBreakouts.delete(parent); }
                }
                publishBreakouts(parent);
                return { jsonrpc: '2.0', id: id!, result: breakoutState(parent, actorId) };
            }
            case 'joinBreakoutRoom': {
                const parsed = z.object({ breakoutRoomId: z.string().uuid().nullable() }).strict().safeParse(params);
                if (!parsed.success) throw createError(-32602, 'Invalid breakout room.');
                const current = roomManager.getRoom(connectionState.roomId!)!;
                const parent = breakoutParent(current);
                const peerId = connectionState.peerId!;
                const peer = current.peers.get(peerId)!;
                if (movingBreakoutPeers.has(peerId)) throw createError(-32004, 'A room transition is already in progress.');
                const destination = parsed.data.breakoutRoomId ? roomManager.getRoom(parsed.data.breakoutRoomId) : parent;
                if (!destination || (destination !== parent && destination.parentRoomId !== parent.id)) throw createError(-32005, 'This breakout does not belong to your meeting.');
                if (destination === current) throw createError(-32004, 'You are already in this room.');
                if (roomIsEnding(parent) || roomIsEnding(current)) throw createError(-32004, 'This meeting is ending.');
                const child = destination !== parent && parent.breakoutRooms?.get(destination.id);
                const mainPeer = parent.peers.get(peerId) || parent.breakoutParticipants?.get(peerId);
                if (!mainPeer || mainPeer.ws !== ws || mainPeer.userId !== connectionState.authUser?.sub) throw createError(-32005, 'Your main-meeting admission is no longer valid.');
                if (child && (!child.open || (!child.assignedPeerIds.has(peerId) && parent.hostPeerId !== peerId))) throw createError(-32005, 'The host has not opened or assigned this breakout to you.');
                if (destination !== parent && !child) throw createError(-32005, 'This breakout is no longer available.');
                if (current.recording?.peerId === peerId) throw createError(-32004, 'Stop your recording before moving to another room.');
                movingBreakoutPeers.add(peerId);
                try {
                    await finishPrivateConversationsForPeer(current.id, peerId, 'participant-left');
                    if (!detachedBreakoutPeers.has(peer)) await sfuClient.removePeer(current.id, peerId);
                    detachedBreakoutPeers.delete(peer);
                    if (ws.readyState !== 1 || current.peers.get(peerId) !== peer) {
                        throw createError(-32004, 'Connection closed during the room transition.');
                    }
                    stopAsrForPeer(current.id, peerId); forgetPeerCaptions(current.id, peerId);
                    meetingObservability.left(current.id, peerId);
                    parent.breakoutParticipants ||= new Map();
                    parent.breakoutParticipants.set(peerId, mainPeer);
                    roomManager.removePeer(current.id, peerId, current === parent);
                    roomManager.broadcast(current.id, 'peerLeft', { peerId, displayName: peer.displayName });
                    connectionState.mainRoomId = parent.id;
                    connectionState.roomId = undefined; connectionState.peerId = undefined;
                    const role = mainPeer.role;
                    const verifyTransition = () => {
                        if (roomIsEnding(parent) || ws.readyState !== 1 || (child && !child.open)) throw createError(-32004, 'The breakout closed while joining.');
                    };
                    try {
                        const joined = await joinPeerToRoom(ws, destination.id, peerId, peer.displayName, peer.rtpCapabilities, connectionState, id!, verifyTransition, role, true);
                        if (destination === parent) parent.breakoutParticipants.delete(peerId);
                        publishBreakouts(parent);
                        return joined;
                    } catch (error) {
                        // Restore an actual parent SFU session when a child join fails after detaching the old room.
                        try {
                            const recovered = await joinPeerToRoom(ws, parent.id, peerId, peer.displayName, peer.rtpCapabilities, connectionState, id!, () => { if (roomIsEnding(parent)) throw createError(-32004, 'The main meeting ended.'); }, role, true);
                            parent.breakoutParticipants.delete(peerId);
                            if (recovered?.result) recovered.result.transitionError = 'The breakout could not be opened. You are back in the main meeting.';
                            publishBreakouts(parent);
                            return recovered;
                        } catch {
                            parent.breakoutParticipants.delete(peerId);
                            ws.close(4000, 'Room transition failed. Rejoin the main meeting.');
                            throw createError(-32004, 'The room transition failed. Rejoin the main meeting.');
                        }
                    }
                } finally { movingBreakoutPeers.delete(peerId); }
            }
            case 'getIceServers': {
                let cached = relayConfigurations.get(ws);
                if (!cached || cached.until < Date.now()) {
                    const request = admittedPeerIceServers(connectionState.peerId!, connectionState.roomId!);
                    cached = { until: Date.now() + 30 * 60 * 1000, request };
                    relayConfigurations.set(ws, cached);
                    request.catch(() => { relayConfigurations.delete(ws); });
                }
                return { jsonrpc: '2.0', id: id!, result: await cached.request };
            }
            case 'setRecordingState': {
                const parsed = z.object({ recording: z.boolean() }).strict().safeParse(params);
                if (!parsed.success) throw createError(-32602, 'Invalid recording state');
                const { peerId, roomId } = connectionState;
                const room = roomManager.getRoom(roomId!);
                const peer = room?.peers.get(peerId!);
                if (!room || !peer?.userId || peer.role !== 'host') {
                    throw createError(-32005, 'Only the signed-in host can control recording');
                }
                if (room.recording && room.recording.peerId !== peerId) {
                    throw createError(-32005, 'Another host session is recording');
                }
                if (parsed.data.recording && !room.settings.allowRecording) {
                    throw createError(-32005, 'Recording is disabled for this meeting');
                }
                if (parsed.data.recording && [...room.privateConversations.values()].some(session => session.status === 'active')) {
                    throw createError(-32005, 'End the private conversation before starting a recording.');
                }
                roomManager.updateRecording(room.id, parsed.data.recording ? { peerId: peer.id, displayName: peer.displayName } : null);
                return { jsonrpc: '2.0', id: id!, result: { recording: room.recording } };
            }
            case 'disconnectBharatVc': {
                const result = await disconnectBharatVc({ ...connectionState, authUser: connectionState.authUser || undefined });
                return { jsonrpc: '2.0', id: id!, result };
            }
            case 'connectBharatVc': {
                const result = await bharatVcDial({ ...connectionState, authUser: connectionState.authUser || undefined }, params);
                return { jsonrpc: '2.0', id: id!, result };
            }
            case 'getEncryptedQuestions':
            case 'putEncryptedQuestion':
            case 'voteEncryptedQuestion':
                return {jsonrpc:'2.0',id:id!,result:encryptedQuestionsRpc(ws,connectionState.roomId!,connectionState.peerId!,method,params)};
            case 'getEncryptedBoard':
            case 'putEncryptedBoard':
            case 'removeEncryptedBoard':
            case 'clearEncryptedBoard':
                return { jsonrpc:'2.0', id:id!, result:encryptedBoardRpc(ws,connectionState.roomId!,connectionState.peerId!,method,params) };
            case 'getEncryptedPollIndex':
            case 'getEncryptedPoll':
            case 'getEncryptedPollResults':
            case 'getEncryptedBallots':
            case 'voteEncryptedPoll':
            case 'closeEncryptedPoll':
            case 'createEncryptedPoll':
            case 'publishEncryptedPoll':
            case 'rewrapEncryptedPoll':
                return { jsonrpc:'2.0', id:id!, result:encryptedPollRpc(ws,connectionState.roomId!,connectionState.peerId!,method,params) };
            case 'getEncryptedNotes':
            case 'putEncryptedNotes':
            case 'getEncryptedFiles':
            case 'putEncryptedFile':
            case 'removeEncryptedFile':
                return { jsonrpc: '2.0', id: id!, result: collaborationRpc(ws, connectionState.roomId!, connectionState.peerId!, method, params) };
            case 'getCollaborationState':
            case 'getCollaborationFile':
            case 'collaborationAction':
                if (roomManager.getRoom(connectionState.roomId!)?.settings.e2eeRequired) throw createError(-32005, 'Shared activities are unavailable in end-to-end encrypted meetings until encrypted collaboration is supported.');
                return { jsonrpc: '2.0', id: id!, result: collaborationRpc(ws, connectionState.roomId!, connectionState.peerId!, method, params) };
            case 'captionPublish': {
                const room = roomManager.getRoom(connectionState.roomId!);
                if (room?.settings.webinar && !canPublishInRoom(room.id, connectionState.peerId!, connectionState.authUser?.sub)) {
                    throw createError(-32005, 'Only the webinar organiser can publish captions');
                }
                if (!can(connectionState.authUser, 'ai_captions')) throw createError(-32005, CAPTION_SPEAKER_PLAN_MESSAGE);
                return { jsonrpc: '2.0', id: id!, result: publishCaption(ws, connectionState.roomId!, connectionState.peerId!, params) };
            }
            case 'captionInterim':
            case 'asrStart':
            case 'asrAudio': {
                // Sharing speech (and using the speech server) is a plan feature; guests can only read captions.
                const room = roomManager.getRoom(connectionState.roomId!);
                if (room?.settings.webinar && !canPublishInRoom(room.id, connectionState.peerId!, connectionState.authUser?.sub)) {
                    throw createError(-32005, 'Only the webinar organiser can publish captions');
                }
                if (!can(connectionState.authUser, 'ai_captions')) throw createError(-32005, CAPTION_SPEAKER_PLAN_MESSAGE);
                const [roomId, peerId] = [connectionState.roomId!, connectionState.peerId!];
                const result = method === 'captionInterim' ? publishInterim(ws, roomId, peerId, params)
                    : method === 'asrStart' ? await startAsr(ws, roomId, peerId, params)
                    : pushAsrAudio(ws, roomId, peerId, params);
                return { jsonrpc: '2.0', id: id!, result };
            }
            case 'asrStop':
                return { jsonrpc: '2.0', id: id!, result: stopAsr(ws, connectionState.roomId!, connectionState.peerId!, true) };
            case 'captionSubscribe': {
                // Guests (and accounts without captions) read captions in ONE language and get no translated voice.
                const targets = (params as { targets?: unknown })?.targets;
                if (!can(connectionState.authUser, 'ai_captions') && Array.isArray(targets) && targets.filter(target => target !== 'original').length > 1) {
                    throw createError(-32005, 'Guests can see captions in one language only');
                }
                return { jsonrpc: '2.0', id: id!, result: subscribeCaptions(ws, connectionState.roomId!, connectionState.peerId!, params) };
            }
            case 'translationCapabilities': {
                const [captions, asr] = await Promise.all([translationCapabilities(ws, connectionState.roomId!, connectionState.peerId!), asrCapabilities()]);
                return { jsonrpc: '2.0', id: id!, result: { ...captions, asr: { ...asr, participants: asrParticipants(connectionState.roomId!) }, minutes: { configured: minutesConfigured() } } };
            }
            case 'setTranscriptSaving': {
                const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(params);
                if (!parsed.success) throw createError(-32602, 'Invalid transcript setting');
                if (!roomManager.isHostOrCoHost(connectionState.roomId!, connectionState.peerId!)) throw createError(-32005, 'Only hosts can save the transcript');
                return { jsonrpc: '2.0', id: id!, result: setTranscriptSaving(connectionState.roomId!, parsed.data.enabled) };
            }
            case 'getTranscript':
                return { jsonrpc: '2.0', id: id!, result: transcriptEntries(connectionState.roomId!) };
            case 'askMeetingAssistant': {
                const account = connectionState.authUser?.sub;
                if (!account) throw createError(-32005, 'Sign in to use the meeting assistant.');
                const request = z.object({
                    question: z.string().trim().min(1).max(2000),
                    context: z.object({
                        isHost: z.boolean().optional(),
                        e2eeActive: z.boolean().optional(),
                        participantsCount: z.number().int().min(0).max(1000).optional(),
                        webinar: z.boolean().optional(),
                    }).optional(),
                }).strict().safeParse(params);
                if (!request.success) throw createError(-32602, 'Enter a question of up to 2,000 characters.');

                const now = Date.now();
                let budget = assistantBudgets.get(account);
                if (budget?.pending) throw createError(-32003, 'Wait for your previous question to finish.');
                if (!budget || budget.until <= now) {
                    budget = { until: now + 60_000, count: 0, pending: false };
                    assistantBudgets.set(account, budget);
                }
                if (budget.count >= 6) throw createError(-32003, 'Please wait a minute before asking another question.');
                budget.count++;
                budget.pending = true;
                try {
                    const quickAnswers = new Map([
                        ['how do i share my screen', 'Select Present in the meeting toolbar, then choose the tab, window or screen you want to share.'],
                        ['verify post-quantum encryption', 'Open the meeting security badge to check the encryption status and compare the verification code with another participant.'],
                        ['how to record this meeting', 'Open More and check the recording options. Availability depends on your role, plan and meeting settings.'],
                        ['troubleshoot microphone / camera', 'Check your browser permissions for this site, then select the intended microphone and camera in meeting settings.'],
                    ]);
                    const quickAnswer = quickAnswers.get(request.data.question.toLowerCase().replace(/[?!.]+$/, '').trim());
                    if (quickAnswer) return { jsonrpc: '2.0', id: id!, result: { answer: quickAnswer } };
                    if (!openRouterConfigured()) throw createError(-32000, 'The online assistant is unavailable for this deployment.');
                    let systemMsg = 'You are the QS-VC meeting help assistant. Explain microphone, camera, presenting, captions, chat, and host controls concisely. Availability depends on role, deployment and plan. You cannot see the room, transcript, account or files, or perform actions. Say when you are unsure.';
                    if (request.data.context) {
                        const { isHost, e2eeActive, participantsCount, webinar } = request.data.context;
                        systemMsg += ` Current Meeting State: User is ${isHost ? 'Meeting Host' : 'Participant'}. Post-Quantum E2EE is ${e2eeActive ? 'ACTIVE (ML-KEM-1024)' : 'Standard'}. Meeting type is ${webinar ? 'Webinar' : 'Conference'}. Participant count is ${participantsCount ?? 'unknown'}.`;
                    }
                    const answer = await askOpenRouter(systemMsg, request.data.question);
                    return { jsonrpc: '2.0', id: id!, result: { answer } };
                } finally { budget.pending = false; }
            }
            case 'generateMeetingSummary': {
                if (!can(connectionState.authUser, 'ai_meeting_summary')) throw createError(-32005, 'Meeting summaries require Pro or higher.');
                const parsed = z.object({
                    language: z.string().max(40).optional(),
                }).strict().safeParse(params || {});
                if (!parsed.success) throw createError(-32602, 'Invalid meeting summary request');
                const roomId = connectionState.roomId!;
                if (!roomManager.isHostOrCoHost(roomId, connectionState.peerId!)) throw createError(-32005, 'Only hosts can create meeting summaries');
                const transcript = transcriptEntries(roomId);
                if (!transcript.saving) throw createError(-32005, 'Turn on “Save transcript” first');
                const room = roomManager.getRoom(roomId);
                if (process.env.QSVC_DEPLOYMENT === 'onprem' && (!room || room.settings.e2eeRequired)) {
                    throw createError(-32005, 'AI summary is unavailable for this protected meeting');
                }
                const participantNames = room ? [...room.peers.values()].map(p => p.displayName) : [];
                const durationMs = transcript.since ? Date.now() - transcript.since : 0;
                const summary = await generateMeetingSummary(transcript.entries, {
                    meetingCode: room?.meetingCode || 'QS-VC',
                    participants: participantNames,
                    durationMs,
                    language: parsed.data.language,
                });
                const saved = Boolean(room && transcript.since && !isSessionMeetingCode(room.meetingCode))
                    && await saveTranscript(room!.meetingCode, [], transcript.since!, undefined, summary);
                return { jsonrpc: '2.0', id: id!, result: { summary, saved } };
            }
            case 'generateMinutes': {
                const parsed = z.object({ language: z.string().max(40).optional() }).strict().safeParse(params || {});
                if (!parsed.success) throw createError(-32602, 'Invalid minutes request');
                const roomId = connectionState.roomId!;
                if (!roomManager.isHostOrCoHost(roomId, connectionState.peerId!)) throw createError(-32005, 'Only hosts can create meeting minutes');
                const transcript = transcriptEntries(roomId);
                if (!transcript.saving) throw createError(-32005, 'Turn on “Save transcript” first');
                const room = roomManager.getRoom(roomId);
                if (process.env.QSVC_DEPLOYMENT === 'onprem' && (!room || room.settings.e2eeRequired)) {
                    throw createError(-32005, 'AI minutes are unavailable for this protected meeting');
                }
                const minutes = await generateMinutes(transcript.entries, parsed.data.language);
                if (room) void saveTranscript(room.meetingCode, [], transcript.since || Date.now(), minutes);
                return { jsonrpc: '2.0', id: id!, result: { minutes } };
            }
            case 'translateCaption':
                return { jsonrpc: '2.0', id: id!, result: await translateCaption(ws, connectionState.roomId!, connectionState.peerId!, params) };

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // JOIN ROOM (with waiting room + password support)
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'joinRoom': {
                if (process.env.QSVC_DEPLOYMENT === 'onprem' && !connectionState.authUser?.sub) {
                    throw createError(-32005, 'Sign in to join this On-prem meeting');
                }
                if (connectionState.peerId || connectionState.roomId) {
                    throw createError(-32000, 'Already joined or waiting for a room');
                }
                // Validate inputs
                const joinParams = joinRoomSchema.safeParse(params);
                if (!joinParams.success) {
                    return {
                        jsonrpc: '2.0', id: id!,
                        error: { code: -32602, message: 'Invalid params: ' + joinParams.error.issues.map(i => i.message).join(', ') },
                    };
                }
                const { meetingCode: requestedCode, displayName: rawName, rtpCapabilities, password, inviteToken, guestToken, guestHostToken } = joinParams.data;
                const sessionMeeting = isSessionMeetingCode(requestedCode);
                const meetingCode = sessionMeeting ? requestedCode.toUpperCase() : requestedCode;
                if (connectionState.expectedMeetingCode && connectionState.expectedMeetingCode !== meetingCode.trim().toUpperCase()) {
                    throw createError(-32001, 'This signaling ticket is valid for a different meeting. Reconnect and try again.');
                }
                const displayName = sanitizeString(rawName);
                const siteLocation = sanitizeString(joinParams.data.siteLocation || '', 120);
                connectionState.siteLocation = siteLocation;
                const peerId = uuidv4();

                // Get or create the signaling room
                // Always resolve persisted ownership before creating a room. An unavailable
                // database must not turn a scheduled meeting into a guest-owned room.
                const codeKey = meetingCode.trim().toUpperCase();
                const isEnded = () => (endedCodes.get(codeKey) ?? 0) > Date.now();
                if (isEnded()) throw createError(-32004, 'This meeting has ended. Ask the organiser for a new invitation.');
                const previousRoom = roomManager.getRoomByCode(meetingCode);
                if (previousRoom?.parentRoomId) throw createError(-32005, 'Enter a breakout through your admitted main-meeting session.');
                const epoch = previousRoom ? roomEpochs.get(previousRoom) || 0 : 0;
                const sharedSchedule = sessionMeeting ? verifySessionMeetingInvite(meetingCode, inviteToken) : null;
                if (sessionMeeting && !sharedSchedule) {
                    throw createError(-32005, 'This meeting invitation is missing or expired. Ask the organiser for a valid link.');
                }
                const guestHosted = sharedSchedule?.hostId === `guest:${meetingCode}`;
                if (guestHosted && (process.env.QSVC_DEPLOYMENT === 'onprem' || process.env.QSVC_ENTERPRISE_TERMS_REQUIRED === 'yes')) {
                    throw createError(-32005, 'Guest hosting is unavailable in this workspace.');
                }
                const guestHost = guestHosted && verifyGuestHostToken(meetingCode, guestHostToken);
                const policy = sharedSchedule ? {
                    hostId: sharedSchedule.hostId,
                    status: 'waiting',
                    settings: {
                        e2eeRequired: sharedSchedule.e2eeRequired,
                        maxParticipants: sharedSchedule.maxParticipants,
                        meetingKind: sharedSchedule.meetingKind,
                        allowRecording: false,
                    },
                } : await loadMeetingPolicy(meetingCode);
                if (policy?.status === 'ended' || isEnded()) {
                    throw createError(-32004, 'This meeting has ended. Ask the organiser for a new invitation.');
                }
                const signedIn = Boolean(connectionState.authUser?.sub);
                if (!previousRoom && !policy && !signedIn) {
                    throw createError(-32005, 'Ask the organiser to start the meeting before joining as a guest.');
                }
                const room = roomManager.getOrCreateRoom(meetingCode, { ...policy?.settings, waitingRoomEnabled: true });
                if (sharedSchedule) sessionInviteExpirations.set(room, sharedSchedule.expiresAt);
                if (!previousRoom) roomManager.scheduleEmptyRoomCleanup(room.id);
                if ((previousRoom && previousRoom !== room) || (roomEpochs.get(room) || 0) !== epoch) {
                    throw createError(-32004, 'This meeting ended or was cancelled while joining. Reconnect to check its status.');
                }
                const checkMeetingOpen = () => {
                    if (roomIsEnding(room) || cancelledRooms.has(room) || (roomEpochs.get(room) || 0) !== epoch) throw createError(-32004, 'This meeting has ended or was cancelled. Reconnect to check its status.');
                };
                // End-to-end (post-quantum keyed) media encryption is on unless the organiser turned it
                // off for this meeting, or the room bridges SIP/H.323 devices that cannot decrypt.
                if (room.settings.e2eeRequired === undefined) room.settings.e2eeRequired = e2eeDefault();
                if (room.settings.e2eeRequired && joinParams.data.supportsE2EE !== true) {
                    throw createError(-32005, 'This meeting uses end-to-end encrypted media. Use a current version of Chrome, Edge, Safari or Firefox.');
                }
                if (policy?.hostId) room.ownerUserId = policy.hostId;
                const verifiedAccess = sharedSchedule ? null : await verifySignalingAccess(meetingCode, {
                    userId: connectionState.authUser?.sub,
                    guestToken,
                    inviteToken,
                });
                checkMeetingOpen();
                if (policy?.status === 'active' || (startedSessionCodes.get(codeKey) ?? 0) > Date.now()) room.hostStarted = true;
                const isInvited = sessionMeeting || verifyMeetingInviteToken(meetingCode, inviteToken) || !!verifiedAccess?.isInvited;
                const isGuestUser = !signedIn || Boolean(guestToken || verifiedAccess?.isGuest);
                const directEntry = canEnterWithoutApproval(room, connectionState.authUser, isGuestUser);
                // Platform admins (role from the server-signed session) can enter and run any meeting.
                const isPlatformAdmin = !sessionMeeting && connectionState.authUser?.role === 'admin';
                const isOwner = guestHost || (!!room.ownerUserId && room.ownerUserId === connectionState.authUser?.sub) || isPlatformAdmin;
                // Google Meet rule: nobody gets in before the host starts the meeting. They wait, and
                // are let in (or asked to knock) automatically when the host arrives.
                if (!room.hostStarted && !isOwner && (room.ownerUserId || !directEntry)) {
                    if (room.settings.password && room.settings.password !== password) {
                        return { jsonrpc: '2.0', id: id!, error: { code: -32001, message: 'Invalid meeting password' } };
                    }
                    if (ws.readyState !== 1) throw createError(-32000, 'Connection closed during join');
                    roomManager.addToWaitingRoom(room.id, { id: peerId, displayName, siteLocation, ws, rtpCapabilities, requestedAt: new Date(), authUser: connectionState.authUser, awaitingHost: true, invited: isInvited, isGuest: isGuestUser, inviteExpiresAt: sharedSchedule?.expiresAt, checkedPassword: room.settings.password, initialRole: verifiedAccess?.role === 'co-host' ? 'co-host' : undefined });
                    connectionState.peerId = peerId;
                    connectionState.roomId = room.id;
                    connectionState.displayName = displayName;
                    return { jsonrpc: '2.0', id: id!, result: { peerId, status: 'waitingForHost', message: 'Waiting for the host to start this meeting' } };
                }

                // Check meeting password
                if (!isOwner && room.settings.password && room.settings.password !== password) {
                    return {
                        jsonrpc: '2.0', id: id!,
                        error: { code: -32001, message: 'Invalid meeting password' },
                    };
                }

                // Check if room is locked
                if (!isOwner && room.settings.locked && room.peers.size > 0) {
                    return {
                        jsonrpc: '2.0', id: id!,
                        error: { code: -32002, message: 'Meeting is locked' },
                    };
                }

                // Check max participants
                if (!isPlatformAdmin && room.peers.size >= room.settings.maxParticipants &&
                    ![...room.peers.values()].some(peer => (guestHost && peer.guestHost) || (peer.userId && !peer.guestHost && peer.userId === connectionState.authUser?.sub))) {
                    return {
                        jsonrpc: '2.0', id: id!,
                        error: { code: -32003, message: 'Meeting is full' },
                    };
                }

                // Guests and removed accounts need approval even after the host has started.
                if (!isOwner && !directEntry) {
                    if (ws.readyState !== 1) throw createError(-32000, 'Connection closed during join');
                    roomManager.addToWaitingRoom(room.id, {
                        id: peerId,
                        displayName,
                        siteLocation,
                        ws,
                        rtpCapabilities,
                        requestedAt: new Date(),
                        authUser: connectionState.authUser,
                        invited: isInvited,
                        inviteExpiresAt: sharedSchedule?.expiresAt,
                        isGuest: isGuestUser,
                    });

                    connectionState.peerId = peerId;
                    connectionState.roomId = room.id;
                    connectionState.displayName = displayName;

                    // Notify host and co-hosts about the new request to join
                    for (const manager of room.peers.values()) {
                        if (isManager(manager)) roomManager.sendToPeer(room.id, manager.id, 'waitingRoomPeer', { peerId, displayName, invited: isInvited, isGuest: isGuestUser });
                    }

                    return {
                        jsonrpc: '2.0', id: id!,
                        result: { peerId, status: 'waiting', message: 'Waiting for host to admit you' },
                    };
                }

                // Direct entry for verified accounts and the organiser.
                const hostWasPresent = room.hostStarted;
                const joined = await joinPeerToRoom(ws, room.id, peerId, displayName, rtpCapabilities, connectionState, id!, () => {
                    checkMeetingOpen();
                    if (sharedSchedule && Date.now() >= sharedSchedule.expiresAt) {
                        throw createError(-32005, 'This meeting invitation has expired. Ask the organiser for a valid link.');
                    }
                    if (!isOwner && room.settings.password && room.settings.password !== password) {
                        throw createError(-32001, 'Invalid meeting password');
                    }
                    if (!isOwner && (!canEnterWithoutApproval(room, connectionState.authUser, isGuestUser) ||
                        (room.ownerUserId && !room.hostStarted))) {
                        throw createError(-32005, 'Meeting access changed. Try joining again.');
                    }
                }, verifiedAccess?.role as any, false, guestHost);
                const me = room.peers.get(peerId);
                if (me?.role === 'host' && joined?.result) joined.result.inviteToken = sessionMeeting ? inviteToken : createMeetingInviteToken(meetingCode);
                if (me?.role === 'host') {
                    if (sharedSchedule) startedSessionCodes.set(codeKey, sharedSchedule.expiresAt);
                    if (!sessionMeeting && !hostWasPresent && room.ownerUserId) void reportMeetingStatus(room.meetingCode, 'active');
                    // Let the host's client finish its join before others stream in.
                    setTimeout(() => { void releaseAwaitingHost(room.id); }, 250);
                }
                return joined;
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // CONNECT TRANSPORT
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'restartIce':
            case 'setConsumerQuality': {
                const { peerId, roomId } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');
                const target = method === 'restartIce' ? params.transportId : params.consumerId;
                if (typeof target !== 'string' || !target || target.length > 128) throw createError(-32602, 'Invalid media identifier');
                if (method === 'setConsumerQuality' && !['high', 'low', 'paused'].includes(params.quality)) throw createError(-32602, 'Invalid quality');
                const result = method === 'restartIce' ? await sfuClient.restartIce(roomId, target, peerId) : await sfuClient.setConsumerQuality(roomId, target, peerId, params.quality);
                return { jsonrpc: '2.0', id: id!, result };
            }
            case 'connectTransport': {
                const { transportId, dtlsParameters } = params;
                const { peerId, roomId } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');

                await sfuClient.connectTransport(roomId, transportId, peerId, dtlsParameters);

                return { jsonrpc: '2.0', id: id!, result: { connected: true } };
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // PRODUCE (publish media)
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'produce': {
                const { transportId, kind, rtpParameters, appData } = params;
                const { peerId, roomId } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');

                const policyRoom = roomManager.getRoom(roomId);
                if (!policyRoom) throw createError(-32000, 'Room not found');
                const privateConversationId = appData?.type === 'private-audio' && typeof appData?.conversationId === 'string'
                    ? appData.conversationId : null;
                const privateConversation = privateConversationId ? policyRoom.privateConversations.get(privateConversationId) : null;
                const isPrivateSideAudio = !!privateConversation && privateConversation.status === 'active' &&
                    [privateConversation.initiatorPeerId, privateConversation.targetPeerId].includes(peerId) &&
                    (privateConversation.endsAt === null || privateConversation.endsAt > Date.now());
                const activeConversationForPeer = [...policyRoom.privateConversations.values()].find(session =>
                    session.status === 'active' && conversationHasPeer(session, peerId));
                if (kind === 'audio' && activeConversationForPeer && !isPrivateSideAudio) {
                    throw createError(-32005, 'Your meeting microphone is paused during the private conversation.');
                }
                if (appData?.type === 'private-audio' && (kind !== 'audio' || !isPrivateSideAudio)) {
                    throw createError(-32005, 'Private audio is only allowed during an active private conversation.');
                }
                if (!isPrivateSideAudio && !canPublishInRoom(roomId, peerId, connectionState.authUser?.sub)) {
                    throw createError(-32005, 'Only the webinar organiser can publish media');
                }

                // Host management: participants need permission to share, talk or show video.
                const producerPeer = policyRoom.peers.get(peerId);
                const screen = appData?.type === 'screen' || appData?.source === 'screen';
                if (screen && producerPeer?.role !== 'host' && !policyRoom.settings.allowScreenShare) throw createError(-32004, 'Screen sharing is disabled by host');
                if (!isManager(producerPeer) && !isPrivateSideAudio) {
                    if (!screen && kind === 'audio' && !policyRoom.settings.allowMicrophone) throw createError(-32004, PERMISSION_MESSAGES.audio);
                    if (!screen && kind === 'video' && !policyRoom.settings.allowCamera) throw createError(-32004, PERMISSION_MESSAGES.video);
                }

                let reservedSources: Set<string> | undefined;
                let source = '';
                if (kind === 'video') {
                    source = screen ? 'screen' : String(appData?.source || 'camera');
                    if (!screen && !['camera', 'camera:2', 'camera:3', 'camera:4'].includes(source)) throw createError(-32602, 'Invalid camera source.');
                    let pending = pendingVideoSources.get(policyRoom);
                    if (!pending) { pending = new Map(); pendingVideoSources.set(policyRoom, pending); }
                    const reservations = pending.get(peerId) || new Set<string>();
                    const active = [...(producerPeer?.producers.values() || [])].filter(producer => producer.kind === 'video');
                    const sameSource = active.some(producer => (producer.appData?.type === 'screen' || producer.appData?.source === 'screen' ? 'screen' : producer.appData?.source || 'camera') === source);
                    if (sameSource || reservations.has(source)) throw createError(-32004, 'This media source is already being shared.');
                    if (screen) {
                        const activeShares = [...policyRoom.peers.values()].filter(peer => [...peer.producers.values()].some(producer => producer.kind === 'video' && (producer.appData?.source === 'screen' || producer.appData?.type === 'screen'))).length;
                        const pendingShares = [...pending.values()].filter(sources => sources.has('screen')).length;
                        if (activeShares + pendingShares >= 4) throw createError(-32004, 'Four screens are already being shared. Stop one before adding another.');
                    } else {
                        const cameras = active.filter(producer => producer.appData?.source !== 'screen' && producer.appData?.type !== 'screen').length;
                        if (cameras + [...reservations].filter(value => value !== 'screen').length >= 4) throw createError(-32004, 'You can share up to four cameras.');
                    }
                    reservations.add(source); pending.set(peerId, reservations); reservedSources = reservations;
                }
                let result;
                try { result = await sfuClient.produce(roomId, peerId, transportId, kind, rtpParameters, appData); }
                finally {
                    reservedSources?.delete(source);
                    if (reservedSources?.size === 0) pendingVideoSources.get(policyRoom)?.delete(peerId);
                }
                if (policyRoom.peers.get(peerId) !== producerPeer || producerPeer?.ws !== ws || roomIsEnding(policyRoom)) {
                    await sfuClient.closeProducer(roomId, peerId, result.producerId).catch(() => {});
                    throw createError(-32004, 'The meeting media session changed.');
                }


                if (screen && producerPeer?.role !== 'host' && !policyRoom.settings.allowScreenShare) {
                    await sfuClient.closeProducer(roomId, peerId, result.producerId).catch(() => {});
                    throw createError(-32004, 'Screen sharing is disabled by host');
                }

                // The session can expire or be ended while the SFU request is in flight.
                if (isPrivateSideAudio && policyRoom.privateConversations.get(privateConversationId!) !== privateConversation) {
                    await sfuClient.closeProducer(roomId, peerId, result.producerId).catch(() => { });
                    throw createError(-32005, 'This private conversation has ended.');
                }
                if (isPrivateSideAudio && privateConversation?.privateAudioMuted?.[peerId]) {
                    await sfuClient.setProducerPaused(roomId, peerId, result.producerId, true);
                }

                // Track the producer in signaling state
                const room = roomManager.getRoom(roomId);
                const peer = room?.peers.get(peerId);
                if (peer) {
                    peer.producers.set(result.producerId, {
                        id: result.producerId,
                        kind,
                        appData: appData || {},
                    });
                    if (screen && kind === 'video') {
                        peer.screenSharing = true;
                    }
                }

                // Private audio is discoverable only by its paired participant.
                const producerNotification = {
                    peerId,
                    producerId: result.producerId,
                    kind,
                    appData: appData || {},
                };
                if (isPrivateSideAudio && privateConversation) {
                    const otherPeerId = privateConversation.initiatorPeerId === peerId
                        ? privateConversation.targetPeerId : privateConversation.initiatorPeerId;
                    roomManager.sendToPeer(roomId, otherPeerId, 'newProducer', producerNotification);
                } else {
                    roomManager.broadcast(roomId, 'newProducer', producerNotification, peerId);
                }

                return { jsonrpc: '2.0', id: id!, result: { producerId: result.producerId } };
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // CONSUME (receive media)
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'consume': {
                const { producerPeerId, producerId } = params;
                const { peerId, roomId } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');

                const room = roomManager.getRoom(roomId);
                const peer = room?.peers.get(peerId);
                if (!peer) throw createError(-32000, 'Peer not found');
                const producerPeer = room?.peers.get(producerPeerId);
                const producerInfo = producerPeer?.producers.get(producerId);
                if (!producerPeer || !producerInfo) throw createError(-32000, 'Producer not found');
                const privateSessionId = producerInfo.appData?.type === 'private-audio' ? producerInfo.appData?.conversationId : null;
                if (privateSessionId) {
                    const privateSession = room?.privateConversations.get(privateSessionId);
                    const isPair = privateSession?.status === 'active' &&
                        ((privateSession.initiatorPeerId === peerId && privateSession.targetPeerId === producerPeerId) ||
                         (privateSession.targetPeerId === peerId && privateSession.initiatorPeerId === producerPeerId));
                    if (!isPair || (privateSession?.endsAt !== null && privateSession?.endsAt !== undefined && privateSession.endsAt <= Date.now())) {
                        throw createError(-32005, 'This private audio is only available to its two participants.');
                    }
                }
                // The browser only knows its receive capabilities after loading the router's
                // capabilities returned by joinRoom, so it sends them with consume.
                const capabilities = z.record(z.string(), z.unknown()).optional().safeParse(params?.rtpCapabilities);
                if (!capabilities.success) throw createError(-32602, 'Invalid rtpCapabilities');
                if (capabilities.data) peer.rtpCapabilities = capabilities.data;
                if (!peer.rtpCapabilities) throw createError(-32602, 'rtpCapabilities required');

                const result = await sfuClient.consume(
                    roomId, peerId, producerPeerId, producerId, peer.rtpCapabilities
                );

                return {
                    jsonrpc: '2.0', id: id!,
                    result: {
                        consumerId: result.consumerId,
                        producerId: result.producerId,
                        kind: result.kind,
                        rtpParameters: result.rtpParameters,
                        producerPeerId,
                        appData: producerInfo.appData || {},
                    },
                };
            }

            case 'closeProducer': {
                const parsed = closeProducerSchema.safeParse(params);
                if (!parsed.success) throw createError(-32602, 'Invalid producer');
                const { peerId, roomId } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');
                const room = roomManager.getRoom(roomId);
                const peer = room?.peers.get(peerId);
                const producer = peer?.producers.get(parsed.data.producerId);
                if (!room || !peer || !producer) throw createError(-32000, 'Producer not found');
                await sfuClient.closeProducer(roomId, peerId, parsed.data.producerId);
                peer.producers.delete(parsed.data.producerId);
                const closedNotification = { peerId, producerId: parsed.data.producerId, kind: producer.kind };
                if (producer.appData?.type === 'private-audio') {
                    const conversation = room.privateConversations.get(producer.appData.conversationId as string);
                    if (conversation && conversationHasPeer(conversation, peerId)) {
                        const otherPeerId = conversation.initiatorPeerId === peerId ? conversation.targetPeerId : conversation.initiatorPeerId;
                        roomManager.sendToPeer(roomId, otherPeerId, 'producerClosed', closedNotification);
                    }
                } else roomManager.broadcast(roomId, 'producerClosed', closedNotification, peerId);
                if (producer.appData?.type === 'screen' || producer.appData?.source === 'screen') {
                    // A replacement presentation may have started while the old SFU close was pending.
                    peer.screenSharing = [...peer.producers.values()].some(current => current.appData?.type === 'screen' || current.appData?.source === 'screen');
                    if (!peer.screenSharing) roomManager.broadcast(roomId, 'presenterChanged', { peerId, displayName: peer.displayName, presenting: false });
                }
                return { jsonrpc: '2.0', id: id!, result: { closed: true } };
            }

            case 'startPrivateConversation': {
                const parsed = privateConversationStartSchema.safeParse(params);
                if (!parsed.success) throw createError(-32602, 'Invalid participant');
                const { peerId, roomId, authUser } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');
                const room = roomManager.getRoom(roomId);
                const initiator = room?.peers.get(peerId);
                const target = room?.peers.get(parsed.data.targetPeerId);
                if (!room || !initiator || !target) throw createError(-32000, 'Participant is no longer in this meeting.');
                if (!authUser?.sub || !initiator.userId || !isManager(initiator)) {
                    throw createError(-32005, 'Only a signed-in host or co-host can start a private conversation.');
                }
                if (room.recording) throw createError(-32005, 'End the meeting recording before starting a private conversation.');
                if (target.id === peerId) throw createError(-32005, 'Choose another participant to talk with privately.');
                if (room.privateConversations.size > 0 && [...room.privateConversations.values()].some(session =>
                    [session.initiatorPeerId, session.targetPeerId].includes(peerId) ||
                    [session.initiatorPeerId, session.targetPeerId].includes(target.id))) {
                    throw createError(-32005, 'One of these participants is already in a private conversation.');
                }
                const durationMs = getPrivateConversationLimitMs(authUser);
                if (!durationMs && durationMs !== null) throw createError(-32005, 'Private conversations are available after signing in.');
                const session: PrivateConversation = {
                    id: uuidv4(), initiatorPeerId: peerId, targetPeerId: target.id,
                    status: 'invited', durationMs, startedAt: null, endsAt: null,
                };
                room.privateConversations.set(session.id, session);
                roomManager.sendToPeer(roomId, target.id, 'privateConversationInvite', {
                    conversationId: session.id,
                    initiatorPeerId: peerId,
                    displayName: initiator.displayName,
                    durationMs,
                });
                roomManager.sendToPeer(roomId, peerId, 'privateConversationState', {
                    conversationId: session.id,
                    status: 'invited',
                    targetPeerId: target.id,
                    displayName: target.displayName,
                    durationMs,
                });
                return { jsonrpc: '2.0', id: id!, result: { conversationId: session.id, status: session.status, durationMs } };
            }

            case 'acceptPrivateConversation': {
                const parsed = privateConversationIdSchema.safeParse(params);
                if (!parsed.success) throw createError(-32602, 'Invalid conversation');
                const { peerId, roomId } = connectionState;
                const room = roomId ? roomManager.getRoom(roomId) : undefined;
                const session = room?.privateConversations.get(parsed.data.conversationId);
                if (!peerId || !room || !session || session.targetPeerId !== peerId || session.status !== 'invited') {
                    throw createError(-32005, 'This invitation is no longer available.');
                }
                if (room.recording) throw createError(-32005, 'End the meeting recording before starting a private conversation.');
                const initiator = room.peers.get(session.initiatorPeerId);
                const target = room.peers.get(session.targetPeerId);
                if (!initiator || !target) {
                    await finishPrivateConversation(room.id, session.id, 'participant-left');
                    throw createError(-32000, 'A participant is no longer in this meeting.');
                }
                session.status = 'activating';
                session.previousAudioMuted = {
                    [initiator.id]: !!initiator.audioMuted,
                    [target.id]: !!target.audioMuted,
                };
                session.privateAudioMuted = { ...session.previousAudioMuted };
                const pausedPeers: PeerState[] = [];
                try {
                    // Pause both public microphone producers before private audio starts.
                    // This protects the room even if a client misses the UI transition.
                    for (const participant of [initiator, target]) {
                        await setPublicMicPaused(room.id, participant, true);
                        participant.audioMuted = true;
                        pausedPeers.push(participant);
                        roomManager.broadcast(room.id, 'peerMuteChanged', {
                            peerId: participant.id,
                            displayName: participant.displayName,
                            kind: 'audio',
                            muted: true,
                        }, participant.id);
                    }
                } catch (error) {
                    for (const participant of pausedPeers) {
                        const wasMuted = session.previousAudioMuted[participant.id];
                        participant.audioMuted = wasMuted;
                        await setPublicMicPaused(room.id, participant, wasMuted).catch(() => { });
                    }
                    if (room.privateConversations.get(session.id) === session) session.status = 'invited';
                    throw createError(-32000, 'The public microphones could not be muted safely. Please try again.');
                }
                if (room.privateConversations.get(session.id) !== session) {
                    for (const participant of pausedPeers) {
                        const wasMuted = session.previousAudioMuted[participant.id];
                        participant.audioMuted = wasMuted;
                        await setPublicMicPaused(room.id, participant, wasMuted).catch(() => { });
                    }
                    throw createError(-32005, 'This private conversation has ended.');
                }
                const now = Date.now();
                session.status = 'active';
                session.startedAt = now;
                session.endsAt = session.durationMs === null ? null : now + session.durationMs;
                if (session.durationMs !== null) {
                    session.timer = setTimeout(() => { void finishPrivateConversation(room.id, session.id, 'time-limit'); }, session.durationMs);
                    (session.timer as any).unref?.();
                }
                for (const [ownPeerId, otherPeer] of [[initiator.id, target], [target.id, initiator]] as const) {
                    roomManager.sendToPeer(room.id, ownPeerId, 'privateConversationStarted', {
                        conversationId: session.id,
                        peerId: otherPeer.id,
                        displayName: otherPeer.displayName,
                        peerMuted: !!session.privateAudioMuted?.[otherPeer.id],
                        durationMs: session.durationMs,
                        startedAt: new Date(now).toISOString(),
                        expiresAt: session.endsAt === null ? null : new Date(session.endsAt).toISOString(),
                    });
                }
                return { jsonrpc: '2.0', id: id!, result: { conversationId: session.id, status: 'active', durationMs: session.durationMs, expiresAt: session.endsAt === null ? null : new Date(session.endsAt).toISOString() } };
            }

            case 'setPrivateConversationMuted': {
                const parsed = privateConversationIdSchema.extend({ muted: z.boolean() }).strict().safeParse(params);
                if (!parsed.success) throw createError(-32602, 'Invalid private microphone state');
                const { peerId, roomId } = connectionState;
                const room = roomId ? roomManager.getRoom(roomId) : undefined;
                const session = room?.privateConversations.get(parsed.data.conversationId);
                if (!peerId || !room || !session || session.status !== 'active' || !conversationHasPeer(session, peerId)) {
                    throw createError(-32005, 'You are not in this private conversation.');
                }
                if (session.endsAt !== null && session.endsAt <= Date.now()) {
                    await finishPrivateConversation(room.id, session.id, 'time-limit');
                    throw createError(-32005, 'This private conversation has ended.');
                }
                session.privateAudioMuted ||= {};
                session.privateAudioMuted[peerId] = parsed.data.muted;
                for (const producer of room.peers.get(peerId)?.producers.values() || []) {
                    if (producer.appData?.type === 'private-audio' && producer.appData?.conversationId === session.id) {
                        await sfuClient.setProducerPaused(room.id, peerId, producer.id, parsed.data.muted);
                    }
                }
                const otherPeerId = session.initiatorPeerId === peerId ? session.targetPeerId : session.initiatorPeerId;
                roomManager.sendToPeer(room.id, otherPeerId, 'privateConversationState', {
                    conversationId: session.id,
                    status: 'active',
                    peerId,
                    muted: parsed.data.muted,
                });
                return { jsonrpc: '2.0', id: id!, result: { muted: parsed.data.muted } };
            }

            case 'declinePrivateConversation':
            case 'cancelPrivateConversation':
            case 'endPrivateConversation': {
                const parsed = privateConversationIdSchema.safeParse(params);
                if (!parsed.success) throw createError(-32602, 'Invalid conversation');
                const { peerId, roomId } = connectionState;
                const room = roomId ? roomManager.getRoom(roomId) : undefined;
                const session = room?.privateConversations.get(parsed.data.conversationId);
                if (!peerId || !room || !session) throw createError(-32000, 'Private conversation not found.');
                if (![session.initiatorPeerId, session.targetPeerId].includes(peerId)) throw createError(-32005, 'You are not part of this private conversation.');
                if (method === 'declinePrivateConversation' && (peerId !== session.targetPeerId || session.status !== 'invited')) throw createError(-32005, 'This invitation cannot be declined.');
                if (method === 'cancelPrivateConversation' && (peerId !== session.initiatorPeerId || session.status !== 'invited')) throw createError(-32005, 'This invitation cannot be cancelled.');
                const reason = method === 'declinePrivateConversation' ? 'declined' : method === 'cancelPrivateConversation' ? 'cancelled' : 'ended';
                await finishPrivateConversation(room.id, session.id, reason, peerId);
                return { jsonrpc: '2.0', id: id!, result: { ended: true } };
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // RESUME CONSUMER
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'resumeConsumer': {
                const { consumerId } = params;
                const { peerId, roomId } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');

                await sfuClient.resumeConsumer(roomId, consumerId, peerId);
                return { jsonrpc: '2.0', id: id!, result: { resumed: true } };
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // CHAT MESSAGE
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'chatMessage': {
                const { peerId, roomId, displayName } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');
                const room = roomManager.getRoom(roomId);
                if (!room || !room.settings.allowChat) throw createError(-32004, 'Chat is disabled by host');
                let payload: Record<string, unknown>;
                if (room.settings.e2eeRequired) {
                    const b64 = (max: number, min = 1) => z.string().min(min).max(max).regex(/^[A-Za-z0-9+/]+={0,2}$/).refine(value => value.length % 4 === 0);
                    const parsed = z.object({ encrypted: z.object({
                        version: z.literal(1), room: z.literal(room.id), keyId: z.number().int().min(0).max(255), epoch: b64(44, 44),
                        senderPeerId: z.literal(peerId), messageId: z.string().uuid(), type: z.literal('chat'), createdAt: z.number().int(),
                        nonce: b64(16, 16), ciphertext: b64(22000, 24), signature: b64(8192, 6000),
                    }).strict() }).strict().safeParse(params);
                    if (!parsed.success) throw createError(-32602, 'This meeting accepts signed encrypted chat only.');
                    if (!room.peers.get(peerId)?.e2eeKeyBundle) throw createError(-32005, 'Register your encryption identity before sending chat.');
                    if (parsed.data.encrypted.createdAt < Date.now() - 120000 || parsed.data.encrypted.createdAt > Date.now() + 30000) throw createError(-32602, 'Encrypted chat message has expired.');
                    payload = { encrypted: parsed.data.encrypted, type: 'encrypted' };
                } else {
                    const parsed = z.object({ content: z.string().trim().min(1).max(4000), type: z.literal('text').optional() }).strict().safeParse(params);
                    if (!parsed.success) throw createError(-32602, 'Invalid chat message.');
                    payload = { content: parsed.data.content, type: 'text' };
                }
                const chatMsg = { id: uuidv4(), peerId, displayName, ...payload, timestamp: new Date().toISOString() };
                roomManager.broadcast(roomId, 'chatMessage', chatMsg);
                return { jsonrpc: '2.0', id: id!, result: { sent: true, messageId: chatMsg.id } };
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // REACTIONS
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'reaction': {
                const { emoji } = params;
                const { peerId, roomId, displayName } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');
                const reactionRoom = roomManager.getRoom(roomId);
                if (reactionRoom && !reactionRoom.settings.allowReactions && !isManager(reactionRoom.peers.get(peerId))) {
                    throw createError(-32004, 'The host has turned off reactions.');
                }
                if (typeof emoji !== 'string' || !emoji || emoji.length > 16) throw createError(-32602, 'Invalid reaction');

                roomManager.broadcast(roomId, 'reaction', {
                    peerId, displayName, emoji,
                    timestamp: new Date().toISOString(),
                });

                return { jsonrpc: '2.0', id: id!, result: { sent: true } };
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // MUTE / UNMUTE NOTIFICATION
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'muteStateChanged': {
                const { kind, muted } = params;
                const { peerId, roomId, displayName } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');

                // Update peer state
                const room = roomManager.getRoom(roomId);
                const peer = room?.peers.get(peerId);
                const activePrivateConversation = room && [...room.privateConversations.values()].find(session =>
                    session.status === 'active' && conversationHasPeer(session, peerId));
                if (kind === 'audio' && muted === false && activePrivateConversation) {
                    throw createError(-32004, 'Your meeting microphone stays muted during a private conversation.');
                }
                if (room && peer && muted === false && !isManager(peer)) {
                    if (kind === 'audio' && !room.settings.allowMicrophone) throw createError(-32004, PERMISSION_MESSAGES.audio);
                    if (kind === 'video' && !room.settings.allowCamera) throw createError(-32004, PERMISSION_MESSAGES.video);
                }
                if (peer) {
                    if (kind === 'audio' && !activePrivateConversation) peer.audioMuted = muted;
                    if (kind === 'video') peer.videoOff = muted;
                }
                if (kind === 'screen' && peer) {
                    // Clients report presenting explicitly; older clients send muted=true while sharing.
                    const presenting = typeof params?.presenting === 'boolean' ? params.presenting : muted === true;
                    if (presenting && peer.role !== 'host' && room && !room.settings.allowScreenShare) throw createError(-32004, 'Screen sharing is disabled by host');
                    peer.screenSharing = presenting;
                    roomManager.broadcast(roomId, 'presenterChanged', { peerId, displayName, presenting });
                }

                roomManager.broadcast(roomId, 'peerMuteChanged', {
                    peerId, displayName, kind, muted,
                }, peerId);

                return { jsonrpc: '2.0', id: id!, result: { ok: true } };
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // RAISE / LOWER HAND
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'raiseHand': {
                const { raised } = params;
                const { peerId, roomId, displayName } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');

                const room = roomManager.getRoom(roomId);
                const peer = room?.peers.get(peerId);
                if (peer) peer.handRaised = raised;

                roomManager.broadcast(roomId, 'handRaised', {
                    peerId, displayName, raised,
                });

                return { jsonrpc: '2.0', id: id!, result: { ok: true } };
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // HOST CONTROLS — Spotlight someone for everyone (null clears it)
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'setSpotlight': {
                const { peerId, roomId, displayName } = connectionState;
                const room = roomManager.getRoom(roomId!);
                if (!room) throw createError(-32000, 'Room not found');
                if (!roomManager.isHostOrCoHost(roomId!, peerId!)) throw createError(-32005, 'Only host/co-host can spotlight');
                const target = params?.targetPeerId ?? null;
                if (target !== null && (typeof target !== 'string' || !room.peers.has(target))) throw createError(-32602, 'Participant not found');
                room.spotlightPeerId = target;
                roomManager.broadcast(roomId!, 'spotlightChanged', { peerId: target, by: displayName });
                return { jsonrpc: '2.0', id: id!, result: { spotlightPeerId: target } };
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // HOST CONTROLS — Invite to / remove from stage (webinars)
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'setStage': {
                const { peerId, roomId, displayName } = connectionState;
                const room = roomManager.getRoom(roomId!);
                if (!room) throw createError(-32000, 'Room not found');
                if (!roomManager.isHostOrCoHost(roomId!, peerId!)) throw createError(-32005, 'Only host/co-host can manage the stage');
                const parsed = z.object({ targetPeerId: z.string(), onStage: z.boolean() }).safeParse(params);
                if (!parsed.success || !room.peers.has(parsed.data.targetPeerId)) throw createError(-32602, 'Participant not found');
                const { targetPeerId, onStage } = parsed.data;
                if (onStage) room.stage.add(targetPeerId); else room.stage.delete(targetPeerId);
                const target = room.peers.get(targetPeerId)!;
                if (!onStage && !isManager(target)) {
                    for (const kind of ['audio', 'video'] as const) roomManager.sendToPeer(roomId!, targetPeerId, 'forceMute', { kind, by: displayName, reason: 'stage' });
                    if (target.screenSharing) roomManager.sendToPeer(roomId!, targetPeerId, 'stopPresenting', { by: displayName });
                    if (room.spotlightPeerId === targetPeerId) { room.spotlightPeerId = null; roomManager.broadcast(roomId!, 'spotlightChanged', { peerId: null }); }
                }
                if (onStage && target.handRaised) { target.handRaised = false; roomManager.broadcast(roomId!, 'handRaised', { peerId: targetPeerId, displayName: target.displayName, raised: false }); }
                roomManager.broadcast(roomId!, 'stageChanged', { peerId: targetPeerId, displayName: target.displayName, onStage, canPublish: canPublishInRoom(roomId!, targetPeerId, target.userId), by: displayName });
                return { jsonrpc: '2.0', id: id!, result: { onStage } };
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // HOST CONTROLS — Lower one raised hand, or all of them
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'lowerHand': {
                const { peerId, roomId, displayName } = connectionState;
                const target = typeof params?.targetPeerId === 'string' ? params.targetPeerId : null;
                const room = roomManager.getRoom(roomId!);
                if (!room) throw createError(-32000, 'Room not found');
                if (!roomManager.isHostOrCoHost(roomId!, peerId!)) throw createError(-32005, 'Only host/co-host can lower hands');
                let lowered = 0;
                for (const p of room.peers.values()) {
                    if ((target && p.id !== target) || !p.handRaised) continue;
                    p.handRaised = false; lowered++;
                    roomManager.broadcast(roomId!, 'handRaised', { peerId: p.id, displayName: p.displayName, raised: false, by: displayName });
                }
                return { jsonrpc: '2.0', id: id!, result: { lowered } };
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // HOST CONTROLS — Admit from waiting room
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'keepWaiting': {
                const parsed = waitingPeerSchema.safeParse(params);
                if (!parsed.success) throw createError(-32602, 'Invalid waiting-room request');
                const { peerId, roomId } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');
                if (!roomManager.isHostOrCoHost(roomId, peerId)) {
                    throw createError(-32005, 'Only host/co-host can manage the waiting room');
                }
                const waiting = roomManager.keepWaiting(roomId, parsed.data.targetPeerId);
                if (!waiting) throw createError(-32000, 'Peer is not waiting for admission');
                roomManager.sendToSocket(waiting.ws, 'waitingStatus', { status: 'keptWaiting' }, waiting.id);
                return { jsonrpc: '2.0', id: id!, result: { keptWaiting: true, peerId: waiting.id } };
            }

            case 'admitPeer': {
                const { targetPeerId } = params;
                const { peerId, roomId } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');
                if (!roomManager.isHostOrCoHost(roomId, peerId)) {
                    throw createError(-32005, 'Only host/co-host can admit peers');
                }

                if (process.env.POLY_BRIDGE_ENABLED === 'true' && typeof targetPeerId === 'string' && targetPeerId.startsWith('poly:')) {
                    await sfuClient.polyLobbyAction(roomId, targetPeerId.slice(5), 'admit');
                } else {
                    await admitWaitingPeer(roomId, targetPeerId);
                }

                return { jsonrpc: '2.0', id: id!, result: { admitted: true, peerId: targetPeerId } };
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // HOST CONTROLS — Reject from waiting room
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'rejectPeer': {
                const { targetPeerId } = params;
                const { peerId, roomId } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');
                if (!roomManager.isHostOrCoHost(roomId, peerId)) {
                    throw createError(-32005, 'Only host/co-host can reject peers');
                }

                if (process.env.POLY_BRIDGE_ENABLED === 'true' && typeof targetPeerId === 'string' && targetPeerId.startsWith('poly:')) {
                    await sfuClient.polyLobbyAction(roomId, targetPeerId.slice(5), 'deny');
                    return { jsonrpc: '2.0', id: id!, result: { rejected: true, peerId: targetPeerId } };
                }
                const waiting = roomManager.rejectFromWaitingRoom(roomId, targetPeerId);
                if (!waiting) throw createError(-32000, 'Peer not in waiting room');

                roomManager.broadcast(roomId, 'waitingRoomUpdated', { peerId: targetPeerId, departed: true });
                // Notify the rejected peer
                roomManager.sendToSocket(waiting.ws, 'rejected', { reason: 'Host denied entry' }, waiting.id);

                return { jsonrpc: '2.0', id: id!, result: { rejected: true, peerId: targetPeerId } };
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // HOST CONTROLS — Admit all waiting
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'admitAll': {
                const { peerId, roomId } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');
                if (!roomManager.isHostOrCoHost(roomId, peerId)) {
                    throw createError(-32005, 'Only host/co-host can admit peers');
                }

                const waitingPeers = roomManager.getWaitingRoom(roomId).filter(w => !w.awaitingHost);
                let admitted = 0;
                const failed: { peerId: string; reason: string }[] = [];
                for (const wp of waitingPeers) {
                    try { await admitWaitingPeer(roomId, wp.id); admitted++; }
                    catch (error: any) { failed.push({ peerId: wp.id, reason: error.message || 'Admission failed' }); }
                }
                return { jsonrpc: '2.0', id: id!, result: { admitted, failed } };
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // HOST CONTROLS — Get waiting room list
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'getWaitingRoom': {
                const { peerId, roomId } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');
                if (!roomManager.isHostOrCoHost(roomId, peerId)) {
                    throw createError(-32005, 'Only host/co-host can view waiting room');
                }

                const list = roomManager.getWaitingRoom(roomId).filter(w => !w.awaitingHost).map(w => ({
                    peerId: w.id,
                    displayName: w.displayName,
                    requestedAt: w.requestedAt.toISOString(),
                    invited: !!w.invited,
                    reviewed: !!w.reviewedAt,
                }));

                return { jsonrpc: '2.0', id: id!, result: { waitingPeers: list } };
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // HOST CONTROLS — Mute participant
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'hostMutePeer': {
                const { targetPeerId, kind } = params;
                const { peerId, roomId } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');
                if (!roomManager.isHostOrCoHost(roomId, peerId)) {
                    throw createError(-32005, 'Only host/co-host can mute participants');
                }

                if (!canManagePeer(roomId, peerId, targetPeerId)) throw createError(-32005, 'Cannot manage this participant');
                if (kind !== undefined && kind !== 'audio' && kind !== 'video') throw createError(-32602, 'kind must be audio or video');

                // Tell the target peer to mute (or turn off their camera)
                const mutedPeer = roomManager.getRoom(roomId)?.peers.get(targetPeerId);
                if (mutedPeer) { if ((kind || 'audio') === 'audio') mutedPeer.audioMuted = true; else mutedPeer.videoOff = true; }
                roomManager.broadcast(roomId, 'peerMuteChanged', { peerId: targetPeerId, kind: kind || 'audio', muted: true }, targetPeerId);
                roomManager.sendToPeer(roomId, targetPeerId, 'forceMute', {
                    kind: kind || 'audio',
                    by: connectionState.displayName,
                });

                return { jsonrpc: '2.0', id: id!, result: { muted: true } };
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // HOST CONTROLS — Mute all
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'muteAll': {
                const { kind } = params;
                const { peerId, roomId } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');
                if (!roomManager.isHostOrCoHost(roomId, peerId)) {
                    throw createError(-32005, 'Only host/co-host can mute all');
                }

                for (const target of roomManager.getRoom(roomId)!.peers.values()) {
                    if (canManagePeer(roomId, peerId, target.id)) roomManager.sendToPeer(roomId, target.id, 'forceMute', {
                        kind: kind || 'audio', by: connectionState.displayName,
                    });
                }

                return { jsonrpc: '2.0', id: id!, result: { mutedAll: true } };
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // HOST CONTROLS — Kick participant
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'kickPeer': {
                const { targetPeerId, reason } = params;
                const { peerId, roomId } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');
                if (!roomManager.isHostOrCoHost(roomId, peerId)) {
                    throw createError(-32005, 'Only host/co-host can kick participants');
                }

                if (!canManagePeer(roomId, peerId, targetPeerId)) throw createError(-32005, 'Cannot manage this participant');

                const room = roomManager.getRoom(roomId)!;
                const kicked = room.peers.get(targetPeerId);
                if (kicked?.userId) (room.parentRoomId ? roomManager.getRoom(room.parentRoomId) : room)?.removedUserIds.add(kicked.userId);

                // Notify the kicked peer
                roomManager.sendToPeer(roomId, targetPeerId, 'kicked', {
                    reason: reason || 'Removed by host',
                    by: connectionState.displayName,
                });

                const cleanup = handlePeerDisconnect({ roomId, peerId: targetPeerId, displayName: kicked?.displayName, mainRoomId: room.parentRoomId });

                // Close their WebSocket
                if (kicked?.ws && kicked.ws.readyState === 1) {
                    kicked.ws.close(4001, 'Kicked by host');
                }

                roomManager.broadcast(roomId, 'peerKicked', {
                    peerId: targetPeerId,
                    displayName: kicked?.displayName,
                    by: connectionState.displayName,
                });

                await cleanup;
                return { jsonrpc: '2.0', id: id!, result: { kicked: true } };
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // HOST CONTROLS — Lock / Unlock meeting
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'transferHost': {
                const parsed = waitingPeerSchema.safeParse(params);
                if (!parsed.success) throw createError(-32602, 'Invalid participant');
                const { peerId, roomId } = connectionState;
                const room = roomManager.getRoom(roomId!);
                if (!room || room.hostPeerId !== peerId || room.peers.get(peerId!)?.role !== 'host') throw createError(-32005, 'Only the current host can transfer host controls.');
                const target = room.peers.get(parsed.data.targetPeerId);
                if (!target || target.id === peerId || !target.userId || target.isGuest) throw createError(-32602, 'Choose a signed-in participant in this meeting.');
                const formerHost = room.peers.get(peerId!);
                roomManager.transferHost(roomId!, peerId!, target.id);
                if (formerHost && !room.settings.allowScreenShare) await stopRestrictedScreenShare(roomId!, formerHost);
                return { jsonrpc: '2.0', id: id!, result: { newHostId: target.id } };
            }

            case 'lockMeeting': {
                const parsed = z.object({ locked: z.boolean() }).strict().safeParse(params);
                if (!parsed.success) throw createError(-32602, 'Invalid lock state');
                const { locked } = parsed.data;
                const { peerId, roomId } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');
                if (!roomManager.isHostOrCoHost(roomId, peerId)) {
                    throw createError(-32005, 'Only host/co-host can lock meeting');
                }

                roomManager.updateSettings(roomId, { locked });
                return { jsonrpc: '2.0', id: id!, result: { locked } };
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // HOST CONTROLS — Update room settings
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'updateSettings': {
                const { settings } = params;
                const { peerId, roomId } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');
                if (!roomManager.isHostOrCoHost(roomId, peerId)) {
                    throw createError(-32005, 'Only host/co-host can update settings');
                }

                const parsedSettings = roomSettingsSchema.safeParse(settings);
                if (!parsedSettings.success) throw createError(-32602, 'Invalid settings');
                if (parsedSettings.data.waitingRoomEnabled === false) {
                    throw createError(-32005, 'Host approval is required for guests.');
                }
                const settingsRoom = roomManager.getRoom(roomId);
                if ((parsedSettings.data.allowScreenShare !== undefined || parsedSettings.data.allowFileShare !== undefined) &&
                    settingsRoom?.peers.get(peerId)?.role !== 'host') {
                    throw createError(-32005, 'Only the host can change sharing permissions.');
                }
                roomManager.updateSettings(roomId, parsedSettings.data);
                if (settingsRoom && parsedSettings.data.allowScreenShare === false) {
                    await Promise.all([...settingsRoom.peers.values()].filter(peer => peer.role !== 'host').map(peer => stopRestrictedScreenShare(roomId, peer)));
                }
                // Turning a permission off applies right away to everyone who is not a host or co-host.
                for (const [key, kind] of [['allowMicrophone', 'audio'], ['allowCamera', 'video']] as const) {
                    if (parsedSettings.data[key] !== false || !settingsRoom) continue;
                    for (const p of settingsRoom.peers.values()) {
                        if (isManager(p)) continue;
                        roomManager.sendToPeer(roomId, p.id, 'forceMute', { kind, by: connectionState.displayName, reason: 'permission' });
                    }
                }
                return { jsonrpc: '2.0', id: id!, result: { updated: true } };
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // HOST CONTROLS — Change peer role
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'changeRole': {
                const { targetPeerId, newRole } = params;
                const { peerId, roomId } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');
                if (roomManager.getRoom(roomId)?.hostPeerId !== peerId) {
                    throw createError(-32005, 'Only host can change roles');
                }

                const validRoles: PeerRole[] = ['co-host', 'member', 'guest'];
                if (!validRoles.includes(newRole)) {
                    throw createError(-32000, 'Invalid role');
                }

                if (targetPeerId === peerId) throw createError(-32005, 'Host cannot demote itself');
                if (newRole !== 'co-host') {
                    const initiatedSessions = [...(roomManager.getRoom(roomId)?.privateConversations.values() || [])]
                        .filter(session => session.initiatorPeerId === targetPeerId);
                    for (const session of initiatedSessions) await finishPrivateConversation(roomId, session.id, 'initiator-role-changed', peerId);
                }
                roomManager.changePeerRole(roomId, targetPeerId, newRole);
                return { jsonrpc: '2.0', id: id!, result: { changed: true } };
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // HOST CONTROLS — End meeting for all
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'endHostedMeeting': {
                const parsed = z.object({ meetingCode: z.string().regex(/^[A-Z0-9-]{4,32}$/), action: z.enum(['end', 'cancel']).default('end') }).strict().safeParse(params);
                if (!parsed.success) throw createError(-32602, 'Invalid meeting code');
                const code = parsed.data.meetingCode;
                const action = parsed.data.action;
                const user = connectionState.authUser;
                if (!user?.sub || !user.tenantId || connectionState.expectedMeetingCode !== code) {
                    throw createError(-32005, 'Sign in with a ticket for this meeting');
                }
                const previousRoom = roomManager.getRoomByCode(code);
                const epoch = previousRoom ? roomEpochs.get(previousRoom) || 0 : 0;
                const policy = await loadMeetingPolicy(code, action === 'cancel');
                if (!policy?.hostId || (policy.hostId !== user.sub && !user.managedMeetingOwnerIds?.includes(policy.hostId))) {
                    throw createError(-32005, 'Only the organiser or a delegated meeting admin can change it here');
                }
                if (action === 'cancel' ? policy.status !== 'waiting' && policy.status !== 'cancelled' : policy.status !== 'active' && policy.status !== 'ended') {
                    throw createError(-32005, 'This meeting can no longer be changed here. Refresh your meetings.');
                }
                // Reserve unused links too, so joins with an older policy response see this run's end.
                const room = roomManager.getOrCreateRoom(code, { ...policy.settings, waitingRoomEnabled: true });
                room.ownerUserId = policy.hostId;
                roomManager.scheduleEmptyRoomCleanup(room.id);
                const pending = dashboardControls.get(room);
                if (pending) {
                    if (pending.sub !== user.sub || pending.tenantId !== user.tenantId || pending.action !== action) {
                        throw createError(-32005, 'A different meeting change is already in progress');
                    }
                    await pending.promise;
                } else {
                    if ((previousRoom && previousRoom !== room) || (roomEpochs.get(room) || 0) !== epoch) {
                        throw createError(-32004, 'This meeting changed while checking its status. Refresh your meetings.');
                    }
                    const promise = (async () => {
                        await endHostedMeetingStatus(code, user.sub, user.tenantId!, action);
                        await endRoomForEveryone(room.id, 'Host', undefined, action);
                    })();
                    dashboardControls.set(room, { sub: user.sub, tenantId: user.tenantId, action, promise });
                    try { await promise; } finally {
                        dashboardControls.delete(room);
                        roomManager.scheduleEmptyRoomCleanup(room.id);
                    }
                }
                return { jsonrpc: '2.0', id: id!, result: action === 'cancel' ? { cancelled: true } : { ended: true } };
            }

            case 'endMeeting': {
                const { peerId, roomId } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');
                if (!roomManager.isHostOrCoHost(roomId, peerId)) {
                    throw createError(-32005, 'Only the host or co-host can end the meeting');
                }

                const room = roomManager.getRoom(roomId);
                if (room?.ownerUserId && !room.parentRoomId && !isSessionMeetingCode(room.meetingCode)) {
                    await reportMeetingStatus(room.meetingCode, 'ended');
                }
                await endRoomForEveryone(roomId, connectionState.displayName || 'Host', peerId);

                return { jsonrpc: '2.0', id: id!, result: { ended: true } };
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // MEDIA STATS (client reports quality)
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'mediaStats': {
                const { stats } = params;
                const { peerId, roomId } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');

                // Log for monitoring (would go to metrics pipeline in production)
                logger.debug({ peerId, roomId, stats }, 'Media stats received');

                return { jsonrpc: '2.0', id: id!, result: { ok: true } };
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // GET ROOM INFO (for participants)
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'startPolyRoom': {
                const { roomId, peerId } = connectionState;
                const room = roomId && roomManager.getRoom(roomId);
                if (process.env.POLY_BRIDGE_ENABLED !== 'true' || !room || !peerId ||
                    room.hostPeerId !== peerId || !connectionState.authUser?.sub || room.settings.webinar || room.settings.locked) {
                    throw createError(-32005, 'Only the signed-in host of an unlocked meeting can enable room devices.');
                }
                try {
                    await sfuClient.startPolyRoom(room.id);
                    return { jsonrpc: '2.0', id: id!, result: { roomAlias: room.id } };
                } catch {
                    throw createError(-32000, 'The MCU bridge could not start. Ask your intranet administrator to check FreeSWITCH and drachtio.');
                }
            }

            case 'polySnapshot': {
                const { roomId, peerId } = connectionState;
                if (process.env.POLY_BRIDGE_ENABLED !== 'true' || !roomId || !peerId || !roomManager.getRoom(roomId)?.peers.has(peerId)) {
                    throw createError(-32005, 'Poly bridge unavailable');
                }
                const snapshot = await sfuClient.polySnapshot(roomId);
                return { jsonrpc: '2.0', id: id!, result: {
                    producers: snapshot.producers,
                    roster: snapshot.roster,
                    lobby: roomManager.isHostOrCoHost(roomId, peerId) ? snapshot.lobby : [],
                } };
            }

            case 'getRoomInfo': {
                const { peerId, roomId } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');

                const room = roomManager.getRoom(roomId);
                if (!room) throw createError(-32000, 'Room not found');

                const peers = Array.from(room.peers.values()).map(p => ({
                    peerId: p.id,
                    displayName: p.displayName,
                    userId: p.userId || null,
                    siteLocation: p.siteLocation || '',
                    role: p.role,
                    audioMuted: p.audioMuted,
                    videoOff: p.videoOff,
                    handRaised: p.handRaised,
                    screenSharing: p.screenSharing,
                    e2eeKeyBundle: p.e2eeKeyBundle,
                    joinedAt: p.joinedAt.toISOString(),
                    producers: Array.from(p.producers.values()).filter(producer => producer.appData?.type !== 'private-audio'),
                }));

                return {
                    jsonrpc: '2.0', id: id!,
                    result: {
                        roomId: room.id,
                        meetingCode: room.meetingCode,
                        settings: { ...room.settings, password: undefined },
                        participants: peers,
                        waitingCount: [...room.waitingRoom.values()].filter(w => !w.awaitingHost).length,
                        hostPresent: !!room.hostPeerId,
                    },
                };
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // E2EE KEY EXCHANGE
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'exchangeE2EEKeys': {
                const { peerId: advertisedPeerId, kemPublicKey, signingPublicKey, signature } = params;
                const room = roomManager.getRoom(connectionState.roomId!);
                if (!room) throw createError(-32002, 'Not in a room');
                if (!room.settings.e2eeRequired) throw createError(-32005, 'End-to-end media encryption was not enabled for this meeting');

                // Store peer's E2EE public key and broadcast to others
                const peer = room.peers.get(connectionState.peerId!);
                if (!peer) throw createError(-32002, 'Peer not found');
                if (advertisedPeerId !== peer.id) throw createError(-32602, 'Encryption key identity does not match the connected peer');

                if ([kemPublicKey, signingPublicKey, signature].some(value => typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length > 7000)) {
                    throw createError(-32602, 'Invalid E2EE key bundle');
                }
                if (peer.e2eeKeyBundle && (peer.e2eeKeyBundle.kemPublicKey !== kemPublicKey || peer.e2eeKeyBundle.signingPublicKey !== signingPublicKey || peer.e2eeKeyBundle.signature !== signature)) {
                    throw createError(-32001, 'Encryption identity cannot change during an active meeting');
                }
                peer.e2eeKeyBundle = { peerId: peer.id, kemPublicKey, signingPublicKey, signature };
                // The first registered participant becomes the key holder and generates the group key.
                const holder = room.e2eeKeyHolderPeerId ? room.peers.get(room.e2eeKeyHolderPeerId) : undefined;
                let generate = false;
                if (!holder?.e2eeKeyBundle) {
                    room.e2eeKeyHolderPeerId = peer.id;
                    peer.e2eeKeyReady = true;
                    generate = true;
                }
                const keyHolder = room.peers.get(room.e2eeKeyHolderPeerId!)!;

                roomManager.broadcast(connectionState.roomId!, 'e2eeKeyExchange', {
                    role: peer.role,
                    ...peer.e2eeKeyBundle,
                    keyHolderPeerId: keyHolder.id,
                }, connectionState.peerId!);

                return {
                    jsonrpc: '2.0', id: id!,
                    result: {
                        registered: true,
                        keyHolderPeerId: keyHolder.id,
                        keyHolderSigningPublicKey: keyHolder.e2eeKeyBundle!.signingPublicKey,
                        generate,
                    },
                };
            }

            case 'distributeEpochKey': {
                const { targetPeerId, envelope } = params;
                const room = roomManager.getRoom(connectionState.roomId!);
                if (!room) throw createError(-32002, 'Not in a room');
                if (!room.settings.e2eeRequired) throw createError(-32005, 'End-to-end media encryption was not enabled for this meeting');
                const sender = room.peers.get(connectionState.peerId!);
                if (!sender || room.e2eeKeyHolderPeerId !== sender.id) throw createError(-32001, 'Only the meeting key holder can distribute the E2EE group key');
                if (typeof targetPeerId !== 'string' || !room.peers.has(targetPeerId) || targetPeerId === sender.id) throw createError(-32602, 'Invalid E2EE key recipient');
                const targetPeer = room.peers.get(targetPeerId);
                if (!sender.e2eeKeyBundle || !targetPeer?.e2eeKeyBundle) throw createError(-32001, 'Both key holder and recipient encryption identities must be registered first');
                if (!Number.isInteger(envelope?.keyId) || envelope.keyId < 0 || envelope.keyId > 255) throw createError(-32602, 'Invalid encrypted E2EE key envelope');
                if (!envelope || envelope.senderPeerId !== sender.id || envelope.targetPeerId !== targetPeerId || ['ciphertext', 'iv', 'encryptedKey', 'signature'].some(key => typeof envelope[key] !== 'string' || envelope[key].length > 7000)) {
                    throw createError(-32602, 'Invalid encrypted E2EE key envelope');
                }

                // Forward encrypted epoch key to specific peer
                roomManager.sendToPeer(room.id, targetPeerId, 'e2eeEpochKey', {
                    keyHolderPeerId: sender.id,
                    hostPeerId: sender.id,
                    hostSigningPublicKey: sender.e2eeKeyBundle.signingPublicKey,
                    envelope,
                });

                return {
                    jsonrpc: '2.0', id: id!,
                    result: { delivered: true },
                };
            }

            case 'e2eeKeyReceived': {
                // The participant installed the current group key, so it can take over as key holder.
                const room = roomManager.getRoom(connectionState.roomId!);
                if (!room) throw createError(-32002, 'Not in a room');
                const peer = room.peers.get(connectionState.peerId!);
                if (!peer?.e2eeKeyBundle) throw createError(-32001, 'Register an encryption identity first');
                peer.e2eeKeyReady = true;
                return { jsonrpc: '2.0', id: id!, result: { ok: true } };
            }

            case 'e2eeRekey': {
                // Triggered when a participant leaves and host re-keys
                const room = roomManager.getRoom(connectionState.roomId!);
                if (!room) throw createError(-32002, 'Not in a room');
                if (!room.settings.e2eeRequired) throw createError(-32005, 'End-to-end media encryption was not enabled for this meeting');
                const actor = room.peers.get(connectionState.peerId!);
                if (!actor || room.e2eeKeyHolderPeerId !== actor.id) throw createError(-32001, 'Only the meeting key holder can rotate the E2EE group key');

                // Broadcast rekey notification to all peers
                roomManager.broadcast(connectionState.roomId!, 'e2eeRekeyRequired', {
                    initiator: connectionState.peerId,
                    reason: 'participant_left',
                });

                return {
                    jsonrpc: '2.0', id: id!,
                    result: { rekeyed: true },
                };
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // LEAVE ROOM
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'leaveRoom': {
                const { peerId, roomId } = connectionState;
                if (!peerId || !roomId) return null;

                await handlePeerDisconnect(connectionState);

                return { jsonrpc: '2.0', id: id!, result: { left: true } };
            }

            default:
                return {
                    jsonrpc: '2.0', id: id!,
                    error: { code: -32601, message: `Method not found: ${method}` },
                };
        }
    } catch (err: any) {
        logger.error(err, `RPC error in method ${method}`);
        return {
            jsonrpc: '2.0', id: id!,
            error: {
                code: err.code || -32000,
                message: err.message || 'Internal error',
            },
        };
    } finally {
        if (method === 'joinRoom') joiningSockets.delete(ws);
    }
}

/**
 * Helper: Join a peer into a room (creates SFU transports, registers, broadcasts).
 */
async function joinPeerToRoom(
    ws: any,
    roomId: string,
    peerId: string,
    displayName: string,
    rtpCapabilities: any,
    connectionState: any,
    rpcId: number | string | null,
    beforeRegister?: () => void,
    initialRole?: PeerRole,
    requireMedia = false,
    guestHost = false
): Promise<RpcResponse | null> {
    const room = roomManager.getRoom(roomId);
    if (!room) throw createError(-32000, 'Room not found');

    const epoch = roomEpochs.get(room) || 0;
    if (roomIsEnding(room) || cancelledRooms.has(room)) throw createError(-32004, 'This meeting is ending or was cancelled');

    // Try to get SFU capabilities — gracefully degrade if SFU is unavailable
    let routerCaps: any = null;
    let sendTransport: any = null;
    let recvTransport: any = null;
    let sfuAvailable = false;

    try {
        const sfuResult = await sfuClient.getRtpCapabilities(roomId);
        routerCaps = sfuResult.rtpCapabilities;
        sendTransport = await sfuClient.createTransport(roomId, peerId, displayName, 'send');
        recvTransport = await sfuClient.createTransport(roomId, peerId, displayName, 'recv');
        sfuAvailable = true;
    } catch (sfuErr: any) {
        logger.warn(`SFU unavailable — joining room ${roomId} in signaling-only mode (chat, presence, reactions work; media relay disabled): ${sfuErr.message}`);
    }

    if (requireMedia && !sfuAvailable) {
        await sfuClient.removePeer(roomId, peerId).catch(() => {});
        throw createError(-32004, 'The breakout media service is unavailable.');
    }

    // Register peer
    const peerState: PeerState = {
        id: peerId,
        displayName,
        siteLocation: connectionState.siteLocation || '',
        ws,
        rtpCapabilities,
        producers: new Map(),
        role: initialRole || (connectionState?.isGuest ? 'guest' : 'member'),
        initialRole,
        isGuest: Boolean(connectionState?.isGuest || initialRole === 'guest'),
        userId: connectionState.authUser?.sub,
        guestHost,
        platformAdmin: connectionState.authUser?.role === 'admin' && !isSessionMeetingCode(room.meetingCode),
        audioMuted: false,
        videoOff: false,
        handRaised: false,
        screenSharing: false,
        joinedAt: new Date(),
    };
    try {
        if (ws.readyState !== 1) throw createError(-32000, 'Connection closed during join');
        if (roomIsEnding(room) || (roomEpochs.get(room) || 0) !== epoch) throw createError(-32004, 'This meeting has ended');
        beforeRegister?.();
        if (!room.parentRoomId && !connectionState.mainRoomId && (guestHost || (peerState.userId && !peerState.isGuest))) {
            const sameAccount = (peer: PeerState) => guestHost ? !!peer.guestHost : peer.userId === peerState.userId && !peer.isGuest && !peer.guestHost;
            const previous = [...room.peers.values()].find(sameAccount) || [...room.breakoutParticipants?.values() || []].find(sameAccount);
            if (previous) {
                if (room.settings.locked && !guestHost && !peerState.platformAdmin && room.ownerUserId !== peerState.userId) {
                    throw createError(-32002, 'Meeting is locked');
                }
                const inMainRoom = room.peers.has(previous.id);
                const remaining = room.peers.size - Number(inMainRoom);
                if (!peerState.platformAdmin && remaining >= room.settings.maxParticipants) {
                    throw createError(-32003, 'Meeting is full');
                }
                if (room.hostPeerId === previous.id) room.hostPeerId = peerId;
                if (previous.role === 'co-host') peerState.initialRole = 'co-host';
                if (inMainRoom) {
                    void handlePeerDisconnect({ roomId, peerId: previous.id, displayName: previous.displayName }, true);
                } else {
                    const child = [...room.breakoutRooms?.keys() || []].find(id => roomManager.getRoom(id)?.peers.has(previous.id));
                    void handlePeerDisconnect({ roomId: child || roomId, mainRoomId: roomId, peerId: previous.id, displayName: previous.displayName });
                }
                if (previous.ws.readyState === 1) previous.ws.close(4002, 'Rejoined from another connection');
            }
        }
        roomManager.addPeer(roomId, peerState);
        meetingObservability.joined(room, peerState);
        if (!room.parentRoomId && room.ownerUserId && !isSessionMeetingCode(room.meetingCode) && connectionState.authUser) {
            void recordMeetingAttendance(room.meetingCode, connectionState.authUser, displayName);
        }
    } catch (error) {
        await sfuClient.removePeer(roomId, peerId).catch(() => { });
        throw error;
    }

    // Store connection state
    if (connectionState) {
        connectionState.peerId = peerId;
        connectionState.roomId = roomId;
        connectionState.displayName = displayName;
    }

    // Get existing peers info
    const existingPeers = Array.from(room.peers.entries())
        .filter(([id]) => id !== peerId)
        .map(([id, p]) => ({
            peerId: id,
            displayName: p.displayName,
            userId: p.userId || null,
            siteLocation: p.siteLocation || '',
            role: p.role,
            audioMuted: p.audioMuted,
            videoOff: p.videoOff,
            handRaised: p.handRaised,
            screenSharing: p.screenSharing,
            onStage: room.stage.has(id),
            e2eeKeyBundle: p.e2eeKeyBundle,
                    producers: Array.from(p.producers.values()).filter(producer => producer.appData?.type !== 'private-audio'),
        }));

    // Notify existing peers
    roomManager.broadcast(roomId, 'newPeer', {
        peerId,
        displayName,
        userId: peerState.userId || null,
        siteLocation: peerState.siteLocation || '',
        role: peerState.role,
    }, peerId);

    const result: any = {
        peerId,
        roomId,
        externalConference: room.externalConference || null,
        role: peerState.role,
        userId: peerState.userId || null,
        siteLocation: peerState.siteLocation || '',
        routerRtpCapabilities: routerCaps,
        canPublish: canPublishInRoom(roomId, peerId, connectionState.authUser?.sub),
        spotlightPeerId: room.spotlightPeerId,
        settings: { ...room.settings, password: undefined },
        recording: room.recording,
        liveStream: room.liveStream || null,
        sendTransport: sfuAvailable ? {
            id: sendTransport.id,
            iceParameters: sendTransport.iceParameters,
            iceCandidates: sendTransport.iceCandidates,
            dtlsParameters: sendTransport.dtlsParameters,
        } : null,
        recvTransport: sfuAvailable ? {
            id: recvTransport.id,
            iceParameters: recvTransport.iceParameters,
            iceCandidates: recvTransport.iceCandidates,
            dtlsParameters: recvTransport.dtlsParameters,
        } : null,
        existingPeers,
        e2eeKeyHolderPeerId: room.e2eeKeyHolderPeerId ?? null,
        sfuAvailable,
        polyBridgeEnabled: process.env.POLY_BRIDGE_ENABLED === 'true',
        hostPresent: !!room.hostPeerId,
        breakout: room.parentRoomId ? { mainRoomId: room.parentRoomId, mainMeetingCode: roomManager.getRoom(room.parentRoomId)?.meetingCode, roomId: room.id, name: roomManager.getRoom(room.parentRoomId)?.breakoutRooms?.get(room.id)?.name } : null,
        isOwner: guestHost || (!!room.ownerUserId && room.ownerUserId === connectionState.authUser?.sub),
    };

    if (rpcId !== null) {
        return { jsonrpc: '2.0', id: rpcId, result };
    }
    return { jsonrpc: '2.0', id: 0, result };
}

/**
 * Handle peer disconnect (WebSocket close or leaveRoom).
 */
export async function handlePeerDisconnect(
    connectionState: { peerId?: string; roomId?: string; displayName?: string; authUser?: VerifiedSignalingUser | null; mainRoomId?: string }, replacing = false
): Promise<void> {
    const { peerId, roomId, displayName, mainRoomId } = connectionState;
    if (!peerId || !roomId) return;
    connectionState.mainRoomId = undefined;
    connectionState.peerId = undefined;
    connectionState.roomId = undefined;
    connectionState.displayName = undefined;

    const room = roomManager.getRoom(roomId);
    const active = room?.peers.has(peerId);
    const waiting = room?.waitingRoom.has(peerId);

    try {
        // Presence must not wait for an unavailable media server.
        stopAsrForPeer(roomId, peerId);
        forgetPeerCaptions(roomId, peerId);
        meetingObservability.left(roomId, peerId);
        if (active || waiting) roomManager.removePeer(roomId, peerId, false, replacing);
        if (!replacing) clearEmptyRoomCaptions(roomId);
        if (active) roomManager.broadcast(roomId, 'peerLeft', { peerId, displayName });
        if (waiting) roomManager.broadcast(roomId, 'waitingRoomUpdated', { peerId, departed: true });
        const main = mainRoomId && roomManager.getRoom(mainRoomId);
        if (main) {
            main.breakoutParticipants?.delete(peerId);
            for (const child of main.breakoutRooms?.values() || []) child.assignedPeerIds.delete(peerId);
            if (main.id !== roomId && main.hostPeerId === peerId) roomManager.removePeer(main.id, peerId);
            roomManager.scheduleEmptyRoomCleanup(main.id);
            publishBreakouts(main);
        }
        if (active) {
            await finishPrivateConversationsForPeer(roomId, peerId, 'participant-left').catch(error => logger.warn(error, 'Private conversation disconnect cleanup failed'));
            await sfuClient.removePeer(roomId, peerId).catch(() => { });
        }
    } catch (err) {
        logger.error(err, `Error during peer disconnect: ${peerId}`);
    }
}

/** End-to-end media encryption is the default. QSVC_E2EE_DEFAULT=off turns the default off. */
function e2eeDefault(): boolean {
    return !/^(off|false|0|no)$/i.test(process.env.QSVC_E2EE_DEFAULT || '');
}

function createError(code: number, message: string): Error & { code: number } {
    const err = new Error(message) as Error & { code: number };
    err.code = code;
    return err;
}
