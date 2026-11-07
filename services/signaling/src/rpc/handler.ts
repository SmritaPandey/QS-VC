import { loadMeetingPolicy, reportMeetingStatus, verifySignalingAccess } from '../meeting-policy.js';
/**
 * JSON-RPC 2.0 Method Handler for QS-VC Signaling.
 *
 * Handles all client↔server signaling messages for WebRTC negotiation,
 * waiting room, host controls, RBAC, and media stats.
 */
import { collaborationRpc } from '../collaboration.js';
import { sfuClient } from '../sfu-client.js';
import { roomManager, PeerState, PeerRole, type PrivateConversation, type VerifiedSignalingUser } from '../room-manager.js';
import { logger } from '../logger.js';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { can, getPrivateConversationLimitMs } from '../../../../shared/entitlements.cjs';
import meetingInvitation from '../../../../shared/meeting-invitation.cjs';
import { publishCaption, publishInterim, subscribeCaptions, translationCapabilities, translateCaption, clearEmptyRoomCaptions, forgetPeerCaptions, setTranscriptSaving, transcriptEntries } from '../captions.js';
import { asrCapabilities, pushAsrAudio, startAsr, stopAsr, stopAsrForPeer } from '../asr-relay.js';
import { generateMinutes, minutesConfigured } from '../minutes.js';
import { saveTranscript } from '../transcript-store.js';

const { createMeetingInviteToken, verifyMeetingInviteToken } = meetingInvitation;
const admittingPeers = new Set<string>();
function canManagePeer(roomId: string, actorId: string, targetId: string): boolean {
    const room = roomManager.getRoom(roomId), actor = room?.peers.get(actorId), target = room?.peers.get(targetId);
    return !!actor && !!target && actorId !== targetId && target.role !== 'host' &&
        (actor.role === 'host' || (actor.role === 'co-host' && target.role !== 'co-host'));
}
/** Hosts and co-hosts are never limited by the participant permissions below. */
function isManager(peer?: PeerState): boolean {
    return peer?.role === 'host' || peer?.role === 'co-host';
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

/**
 * The host has arrived: move pre-host attendees into the host's approval queue.
 */
function releaseAwaitingHost(roomId: string): void {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    for (const waiting of [...room.waitingRoom.values()]) {
        if (!waiting.awaitingHost) continue;
        waiting.awaitingHost = false;
        roomManager.sendToSocket(waiting.ws, 'waitingStatus', { status: 'knocking' }, waiting.id);
        if (room.hostPeerId) roomManager.sendToPeer(roomId, room.hostPeerId, 'waitingRoomPeer', { peerId: waiting.id, displayName: waiting.displayName });
        for (const peer of room.peers.values()) if (peer.role === 'co-host') roomManager.sendToPeer(roomId, peer.id, 'waitingRoomPeer', { peerId: waiting.id, displayName: waiting.displayName });
    }
}

async function admitWaitingPeer(roomId: string, targetId: string) {
    const room = roomManager.getRoom(roomId), waiting = room?.waitingRoom.get(targetId);
    if (!room || !waiting) throw createError(-32000, 'Peer not in waiting room');
    if (admittingPeers.has(targetId)) throw createError(-32000, 'Admission already in progress');
    admittingPeers.add(targetId);
    try {
        const result = await joinPeerToRoom(waiting.ws, roomId, waiting.id, waiting.displayName, waiting.rtpCapabilities, { authUser: waiting.authUser }, null,
            () => { if (room.waitingRoom.get(targetId) !== waiting) throw createError(-32000, 'Admission cancelled'); },
            waiting.isGuest ? 'guest' : undefined);
        room.waitingRoom.delete(targetId);
        roomManager.sendToSocket(waiting.ws, 'admitted', result?.result || {}, waiting.id);
        return result;
    } finally { admittingPeers.delete(targetId); }
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
    allowScreenShare: z.boolean().optional(), allowChat: z.boolean().optional(),
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
    inviteToken: z.string().max(128).optional(),
    guestToken: z.string().max(128).optional(),
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

const joiningSockets = new WeakSet<object>();
const CAPTION_SPEAKER_PLAN_MESSAGE = 'Sign in with a plan that includes captions to share your speech';

/**
 * Handle a JSON-RPC request from a WebSocket client.
 */
export async function handleRpcMessage(
    ws: any,
    message: RpcRequest,
    connectionState: { peerId?: string; roomId?: string; displayName?: string; authUser?: VerifiedSignalingUser | null; expectedMeetingCode?: string; joinAttempts?: number }
): Promise<RpcResponse | null> {
    const { method, params, id } = message;

    // Waiting, removed and stale connections must not act as active participants.
    if (method !== 'joinRoom' && method !== 'leaveRoom') {
        const peer = roomManager.getRoom(connectionState.roomId || '')?.peers.get(connectionState.peerId || '');
        if (!peer || peer.ws !== ws) {
            return { jsonrpc: '2.0', id: id!, error: { code: -32000, message: 'Not joined a room' } };
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
            case 'getCollaborationState':
            case 'getCollaborationFile':
            case 'collaborationAction':
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
                return { jsonrpc: '2.0', id: id!, result: stopAsr(ws, connectionState.roomId!, connectionState.peerId!) };
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
                return { jsonrpc: '2.0', id: id!, result: { ...captions, asr, minutes: { configured: minutesConfigured() } } };
            }
            case 'setTranscriptSaving': {
                const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(params);
                if (!parsed.success) throw createError(-32602, 'Invalid transcript setting');
                if (!roomManager.isHostOrCoHost(connectionState.roomId!, connectionState.peerId!)) throw createError(-32005, 'Only hosts can save the transcript');
                return { jsonrpc: '2.0', id: id!, result: setTranscriptSaving(connectionState.roomId!, parsed.data.enabled) };
            }
            case 'getTranscript':
                return { jsonrpc: '2.0', id: id!, result: transcriptEntries(connectionState.roomId!) };
            case 'generateMinutes': {
                const parsed = z.object({ language: z.string().max(40).optional() }).strict().safeParse(params || {});
                if (!parsed.success) throw createError(-32602, 'Invalid minutes request');
                const roomId = connectionState.roomId!;
                if (!roomManager.isHostOrCoHost(roomId, connectionState.peerId!)) throw createError(-32005, 'Only hosts can create meeting minutes');
                const transcript = transcriptEntries(roomId);
                if (!transcript.saving) throw createError(-32005, 'Turn on “Save transcript” first');
                const minutes = await generateMinutes(transcript.entries, parsed.data.language);
                const room = roomManager.getRoom(roomId);
                if (room) void saveTranscript(room.meetingCode, [], transcript.since || Date.now(), minutes);
                return { jsonrpc: '2.0', id: id!, result: { minutes } };
            }
            case 'translateCaption':
                return { jsonrpc: '2.0', id: id!, result: await translateCaption(ws, connectionState.roomId!, connectionState.peerId!, params) };

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // JOIN ROOM (with waiting room + password support)
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'joinRoom': {
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
                const { meetingCode, displayName: rawName, rtpCapabilities, password, inviteToken, guestToken } = joinParams.data;
                if (connectionState.expectedMeetingCode && connectionState.expectedMeetingCode !== meetingCode.trim().toUpperCase()) {
                    throw createError(-32001, 'This signaling ticket is valid for a different meeting. Reconnect and try again.');
                }
                const displayName = sanitizeString(rawName);
                const peerId = uuidv4();

                // Get or create the signaling room
                // Always resolve persisted ownership before creating a room. An unavailable
                // database must not turn a scheduled meeting into a guest-owned room.
                const policy = await loadMeetingPolicy(meetingCode);
                const room = roomManager.getOrCreateRoom(meetingCode, { ...policy?.settings, waitingRoomEnabled: true });
                // End-to-end (post-quantum keyed) media encryption is on unless the organiser turned it
                // off for this meeting, or the room bridges SIP/H.323 devices that cannot decrypt.
                if (room.settings.e2eeRequired === undefined) room.settings.e2eeRequired = e2eeDefault();
                if (room.settings.e2eeRequired && joinParams.data.supportsE2EE !== true) {
                    throw createError(-32005, 'This meeting uses end-to-end encrypted media. Use a current version of Chrome, Edge, Safari or Firefox.');
                }
                if (policy?.hostId) room.ownerUserId = policy.hostId;
                const verifiedAccess = await verifySignalingAccess(meetingCode, {
                    userId: connectionState.authUser?.sub,
                    guestToken,
                    inviteToken,
                });
                const isInvited = verifyMeetingInviteToken(meetingCode, inviteToken) || !!verifiedAccess?.isInvited;
                const isGuestUser = !!verifiedAccess?.isGuest || !connectionState.authUser?.sub;
                const webinarGuest = room.settings.webinar && isGuestUser && !isInvited;
                // Platform admins (role from the server-signed session) can enter and run any meeting.
                const isPlatformAdmin = connectionState.authUser?.role === 'admin';
                const isOwner = (!!room.ownerUserId && room.ownerUserId === connectionState.authUser?.sub) || isPlatformAdmin;
                // Google Meet rule: nobody gets in before the host starts the meeting. They wait, and
                // are let in (or asked to knock) automatically when the host arrives.
                if (policy?.status === 'ended' && !room.hostStarted && !isOwner) {
                    throw createError(-32004, 'This meeting has ended. Ask the organiser to restart it or send a new invitation.');
                }
                if (room.ownerUserId && !room.hostStarted && !isOwner) {
                    if (room.settings.password && room.settings.password !== password) {
                        return { jsonrpc: '2.0', id: id!, error: { code: -32001, message: 'Invalid meeting password' } };
                    }
                    roomManager.addToWaitingRoom(room.id, { id: peerId, displayName, ws, rtpCapabilities, requestedAt: new Date(), authUser: connectionState.authUser, awaitingHost: true, invited: isInvited, isGuest: isGuestUser });
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
                if (!isPlatformAdmin && room.peers.size >= room.settings.maxParticipants) {
                    return {
                        jsonrpc: '2.0', id: id!,
                        error: { code: -32003, message: 'Meeting is full' },
                    };
                }

                // Waiting room: if enabled and not the first peer (host), put in waiting room
                if (!isOwner && (webinarGuest || (room.settings.waitingRoomEnabled && room.peers.size > 0))) {
                    roomManager.addToWaitingRoom(room.id, {
                        id: peerId,
                        displayName,
                        ws,
                        rtpCapabilities,
                        requestedAt: new Date(),
                        authUser: connectionState.authUser,
                        invited: isInvited,
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

                // Direct join (no waiting room or first peer)
                const hostWasPresent = room.hostStarted;
                const joined = await joinPeerToRoom(ws, room.id, peerId, displayName, rtpCapabilities, connectionState, id!, undefined, verifiedAccess?.role as any);
                const me = room.peers.get(peerId);
                if (me?.role === 'host' && joined?.result) joined.result.inviteToken = createMeetingInviteToken(meetingCode);
                if (me?.role === 'host') {
                    if (!hostWasPresent && room.ownerUserId) void reportMeetingStatus(room.meetingCode, 'active');
                    // Let the host's client finish its join before others stream in.
                    setTimeout(() => releaseAwaitingHost(room.id), 250);
                }
                return joined;
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // CONNECT TRANSPORT
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
                if (!isManager(producerPeer) && !isPrivateSideAudio) {
                    if (screen && !policyRoom.settings.allowScreenShare) throw createError(-32004, 'Screen sharing is disabled by host');
                    if (!screen && kind === 'audio' && !policyRoom.settings.allowMicrophone) throw createError(-32004, PERMISSION_MESSAGES.audio);
                    if (!screen && kind === 'video' && !policyRoom.settings.allowCamera) throw createError(-32004, PERMISSION_MESSAGES.video);
                }

                const result = await sfuClient.produce(roomId, peerId, transportId, kind, rtpParameters, appData);

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
                    if (appData?.type === 'screen') {
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
                if (producer.appData?.type === 'screen' || producer.appData?.source === 'screen') {
                    peer.screenSharing = false;
                    roomManager.broadcast(roomId, 'presenterChanged', { peerId, displayName: peer.displayName, presenting: false });
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
                const { content, type } = params;
                const { peerId, roomId, displayName } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');

                // Check chat permission
                const room = roomManager.getRoom(roomId);
                if (room && !room.settings.allowChat) {
                    throw createError(-32004, 'Chat is disabled by host');
                }

                const chatMsg = {
                    id: uuidv4(),
                    peerId,
                    displayName,
                    type: type || 'text',
                    content,
                    timestamp: new Date().toISOString(),
                };

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
                    if (presenting && !isManager(peer) && room && !room.settings.allowScreenShare) throw createError(-32004, 'Screen sharing is disabled by host');
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

                // Notify the kicked peer
                roomManager.sendToPeer(roomId, targetPeerId, 'kicked', {
                    reason: reason || 'Removed by host',
                    by: connectionState.displayName,
                });

                // Remove from SFU and signaling
                await finishPrivateConversationsForPeer(roomId, targetPeerId, 'participant-left');
                await sfuClient.removePeer(roomId, targetPeerId).catch(() => { });
                const kicked = roomManager.removePeer(roomId, targetPeerId);

                // Close their WebSocket
                if (kicked?.ws && kicked.ws.readyState === 1) {
                    kicked.ws.close(4001, 'Kicked by host');
                }

                roomManager.broadcast(roomId, 'peerKicked', {
                    peerId: targetPeerId,
                    displayName: kicked?.displayName,
                    by: connectionState.displayName,
                });

                return { jsonrpc: '2.0', id: id!, result: { kicked: true } };
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // HOST CONTROLS — Lock / Unlock meeting
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'lockMeeting': {
                const { locked } = params;
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
                    throw createError(-32005, 'Host approval is required for every attendee.');
                }
                roomManager.updateSettings(roomId, parsedSettings.data);
                // Turning a permission off applies right away to everyone who is not a host or co-host.
                const settingsRoom = roomManager.getRoom(roomId);
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
            case 'endMeeting': {
                const { peerId, roomId } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');
                if (roomManager.getRoom(roomId)?.peers.get(peerId)?.role !== 'host') {
                    throw createError(-32005, 'Only host can end meeting');
                }

                // Notify all peers
                roomManager.updateRecording(roomId, null);
                if (process.env.POLY_BRIDGE_ENABLED === 'true') {
                    await sfuClient.stopPolyRoom(roomId).catch(error => logger.warn(error, 'Poly bridge stop failed'));
                }
                const endedRoom = roomManager.getRoom(roomId);
                if (endedRoom?.ownerUserId) void reportMeetingStatus(endedRoom.meetingCode, 'ended');
                roomManager.broadcast(roomId, 'meetingEnded', {
                    by: connectionState.displayName,
                    reason: 'Host ended the meeting',
                });

                // Remove all peers
                const room = roomManager.getRoom(roomId);
                if (room) {
                    for (const session of [...room.privateConversations.values()]) {
                        await finishPrivateConversation(roomId, session.id, 'meeting-ended', peerId);
                    }
                    for (const [pid, p] of room.peers) {
                        await sfuClient.removePeer(roomId, pid).catch(() => { });
                        if (p.ws && p.ws.readyState === 1) {
                            p.ws.close(4000, 'Meeting ended');
                        }
                    }
                    room.peers.clear();
                    room.hostPeerId = null;
                    room.hostStarted = false;
                    for (const waiting of room.waitingRoom.values()) {
                        if (waiting.ws?.readyState === 1) {
                            roomManager.sendToSocket(waiting.ws, 'rejected', { reason: 'Host ended the meeting' }, waiting.id);
                            waiting.ws.close(4000, 'Meeting ended');
                        }
                    }
                    room.waitingRoom.clear();
                }

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
    initialRole?: PeerRole
): Promise<RpcResponse | null> {
    const room = roomManager.getRoom(roomId);
    if (!room) throw createError(-32000, 'Room not found');

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

    // Register peer
    const peerState: PeerState = {
        id: peerId,
        displayName,
        ws,
        rtpCapabilities,
        producers: new Map(),
        role: initialRole || (connectionState.authUser?.sub ? 'member' : 'guest'),
        initialRole,
        userId: connectionState.authUser?.sub,
        platformAdmin: connectionState.authUser?.role === 'admin',
        audioMuted: false,
        videoOff: false,
        handRaised: false,
        screenSharing: false,
        joinedAt: new Date(),
    };
    try {
        if (ws.readyState !== 1) throw createError(-32000, 'Connection closed during join');
        beforeRegister?.();
        roomManager.addPeer(roomId, peerState);
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
        role: peerState.role,
    }, peerId);

    const result: any = {
        peerId,
        roomId,
        role: peerState.role,
        routerRtpCapabilities: routerCaps,
        canPublish: canPublishInRoom(roomId, peerId, connectionState.authUser?.sub),
        spotlightPeerId: room.spotlightPeerId,
        settings: { ...room.settings, password: undefined },
        recording: room.recording,
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
        isOwner: !!room.ownerUserId && room.ownerUserId === connectionState.authUser?.sub,
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
    connectionState: { peerId?: string; roomId?: string; displayName?: string; authUser?: VerifiedSignalingUser | null }
): Promise<void> {
    const { peerId, roomId, displayName } = connectionState;
    if (!peerId || !roomId) return;

    try {
        await finishPrivateConversationsForPeer(roomId, peerId, 'participant-left');
        await sfuClient.removePeer(roomId, peerId).catch(() => { });

        stopAsrForPeer(roomId, peerId);
        forgetPeerCaptions(roomId, peerId);
        roomManager.removePeer(roomId, peerId);
        clearEmptyRoomCaptions(roomId);
        roomManager.broadcast(roomId, 'peerLeft', { peerId, displayName });
    } catch (err) {
        logger.error(err, `Error during peer disconnect: ${peerId}`);
    }

    connectionState.peerId = undefined;
    connectionState.roomId = undefined;
    connectionState.displayName = undefined;
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
