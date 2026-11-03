import { loadMeetingPolicy } from '../meeting-policy.js';
/**
 * JSON-RPC 2.0 Method Handler for QS-VC Signaling.
 *
 * Handles all client↔server signaling messages for WebRTC negotiation,
 * waiting room, host controls, RBAC, and media stats.
 */
import { collaborationRpc } from '../collaboration.js';
import { sfuClient } from '../sfu-client.js';
import { roomManager, PeerState, PeerRole } from '../room-manager.js';
import { logger } from '../logger.js';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { publishCaption, translationCapabilities, translateCaption, clearEmptyRoomCaptions } from '../captions.js';

const admittingPeers = new Set<string>();
function canManagePeer(roomId: string, actorId: string, targetId: string): boolean {
    const room = roomManager.getRoom(roomId), actor = room?.peers.get(actorId), target = room?.peers.get(targetId);
    return !!actor && !!target && actorId !== targetId && target.role !== 'host' &&
        (actor.role === 'host' || (actor.role === 'co-host' && target.role !== 'co-host'));
}
async function admitWaitingPeer(roomId: string, targetId: string) {
    const room = roomManager.getRoom(roomId), waiting = room?.waitingRoom.get(targetId);
    if (!room || !waiting) throw createError(-32000, 'Peer not in waiting room');
    if (admittingPeers.has(targetId)) throw createError(-32000, 'Admission already in progress');
    admittingPeers.add(targetId);
    try {
        const result = await joinPeerToRoom(waiting.ws, roomId, waiting.id, waiting.displayName, waiting.rtpCapabilities, {}, null,
            () => { if (room.waitingRoom.get(targetId) !== waiting) throw createError(-32000, 'Admission cancelled'); });
        room.waitingRoom.delete(targetId);
        if (waiting.ws.readyState === 1) waiting.ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'admitted', params: result?.result || {} }));
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

// RPC param validation schemas
const roomSettingsSchema = z.object({
    maxParticipants: z.number().int().min(1).max(1000).optional(),
    waitingRoomEnabled: z.boolean().optional(), locked: z.boolean().optional(),
    password: z.string().max(50).nullable().optional(), muteOnEntry: z.boolean().optional(),
    allowScreenShare: z.boolean().optional(), allowChat: z.boolean().optional(),
    allowRecording: z.boolean().optional(),
}).strict();

const joinRoomSchema = z.object({
    meetingCode: z.string().min(1).max(30),
    displayName: z.string().min(1).max(100),
    rtpCapabilities: z.record(z.string(), z.unknown()).optional(),
    password: z.string().max(50).optional(),
    role: z.enum(['host', 'co-host', 'participant']).optional(),
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

/**
 * Handle a JSON-RPC request from a WebSocket client.
 */
export async function handleRpcMessage(
    ws: any,
    message: RpcRequest,
    connectionState: { peerId?: string; roomId?: string; displayName?: string; authUser?: { sub: string; role?: string } | null }
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
    if (method === 'joinRoom') joiningSockets.add(ws);
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
                roomManager.updateRecording(room.id, parsed.data.recording ? { peerId: peer.id, displayName: peer.displayName } : null);
                return { jsonrpc: '2.0', id: id!, result: { recording: room.recording } };
            }
            case 'getCollaborationState':
            case 'getCollaborationFile':
            case 'collaborationAction':
                return { jsonrpc: '2.0', id: id!, result: collaborationRpc(ws, connectionState.roomId!, connectionState.peerId!, method, params) };
            case 'captionPublish':
                return { jsonrpc: '2.0', id: id!, result: publishCaption(ws, connectionState.roomId!, connectionState.peerId!, params) };
            case 'translationCapabilities':
                return { jsonrpc: '2.0', id: id!, result: await translationCapabilities(ws, connectionState.roomId!, connectionState.peerId!) };
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
                const { meetingCode, displayName: rawName, rtpCapabilities, password } = joinParams.data;
                const displayName = sanitizeString(rawName);
                const peerId = uuidv4();

                // Get or create the signaling room
                // Always resolve persisted ownership before creating a room. An unavailable
                // database must not turn a scheduled meeting into a guest-owned room.
                const policy = await loadMeetingPolicy(meetingCode);
                const room = roomManager.getOrCreateRoom(meetingCode, policy?.settings);
                if (policy?.hostId) room.ownerUserId = policy.hostId;
                // Platform admins (role from the server-signed session) can enter and run any meeting.
                const isPlatformAdmin = connectionState.authUser?.role === 'admin';
                const isOwner = (!!room.ownerUserId && room.ownerUserId === connectionState.authUser?.sub) || isPlatformAdmin;
                if (room.ownerUserId && !room.hostPeerId && !isOwner) throw createError(-32004, 'The meeting organiser must join first.');

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
                if (!isOwner && room.settings.waitingRoomEnabled && room.peers.size > 0) {
                    roomManager.addToWaitingRoom(room.id, {
                        id: peerId,
                        displayName,
                        ws,
                        rtpCapabilities,
                        requestedAt: new Date(),
                    });

                    connectionState.peerId = peerId;
                    connectionState.roomId = room.id;
                    connectionState.displayName = displayName;

                    // Notify host about new waiting peer
                    if (room.hostPeerId) {
                        roomManager.sendToPeer(room.id, room.hostPeerId, 'waitingRoomPeer', {
                            peerId, displayName,
                        });
                    }

                    return {
                        jsonrpc: '2.0', id: id!,
                        result: { peerId, status: 'waiting', message: 'Waiting for host to admit you' },
                    };
                }

                // Direct join (no waiting room or first peer)
                return await joinPeerToRoom(ws, room.id, peerId, displayName, rtpCapabilities, connectionState, id!);
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

                // Check screen share permission
                if (appData?.type === 'screen') {
                    const room = roomManager.getRoom(roomId);
                    if (room && !room.settings.allowScreenShare) {
                        throw createError(-32004, 'Screen sharing is disabled by host');
                    }
                }

                const result = await sfuClient.produce(roomId, peerId, transportId, kind, rtpParameters, appData);

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

                // Notify other peers about the new producer
                roomManager.broadcast(roomId, 'newProducer', {
                    peerId,
                    producerId: result.producerId,
                    kind,
                    appData: appData || {},
                }, peerId);

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
                    },
                };
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
                if (peer) {
                    if (kind === 'audio') peer.audioMuted = muted;
                    if (kind === 'video') peer.videoOff = muted;
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

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // HOST CONTROLS — Admit from waiting room
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'admitPeer': {
                const { targetPeerId } = params;
                const { peerId, roomId } = connectionState;
                if (!peerId || !roomId) throw createError(-32000, 'Not joined a room');
                if (!roomManager.isHostOrCoHost(roomId, peerId)) {
                    throw createError(-32005, 'Only host/co-host can admit peers');
                }

                await admitWaitingPeer(roomId, targetPeerId);

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

                const waiting = roomManager.rejectFromWaitingRoom(roomId, targetPeerId);
                if (!waiting) throw createError(-32000, 'Peer not in waiting room');

                // Notify the rejected peer
                if (waiting.ws && waiting.ws.readyState === 1) {
                    waiting.ws.send(JSON.stringify({
                        jsonrpc: '2.0',
                        method: 'rejected',
                        params: { reason: 'Host denied entry' },
                    }));
                }

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

                const waitingPeers = roomManager.getWaitingRoom(roomId);
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

                const list = roomManager.getWaitingRoom(roomId).map(w => ({
                    peerId: w.id,
                    displayName: w.displayName,
                    requestedAt: w.requestedAt.toISOString(),
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

                // Tell the target peer to mute
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

                roomManager.updateSettings(roomId, roomSettingsSchema.parse(settings));
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
                roomManager.broadcast(roomId, 'meetingEnded', {
                    by: connectionState.displayName,
                    reason: 'Host ended the meeting',
                });

                // Remove all peers
                const room = roomManager.getRoom(roomId);
                if (room) {
                    for (const [pid, p] of room.peers) {
                        await sfuClient.removePeer(roomId, pid).catch(() => { });
                        if (p.ws && p.ws.readyState === 1) {
                            p.ws.close(4000, 'Meeting ended');
                        }
                    }
                    room.peers.clear();
                    room.hostPeerId = null;
                    for (const waiting of room.waitingRoom.values()) {
                        if (waiting.ws?.readyState === 1) {
                            waiting.ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'rejected', params: { reason: 'Host ended the meeting' } }));
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
                    joinedAt: p.joinedAt.toISOString(),
                    producers: Array.from(p.producers.values()),
                }));

                return {
                    jsonrpc: '2.0', id: id!,
                    result: {
                        roomId: room.id,
                        meetingCode: room.meetingCode,
                        settings: { ...room.settings, password: undefined },
                        participants: peers,
                        waitingCount: room.waitingRoom.size,
                    },
                };
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // E2EE KEY EXCHANGE
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            case 'exchangeE2EEKeys': {
                const { publicKey } = params;
                const room = roomManager.getRoom(connectionState.roomId!);
                if (!room) throw createError(-32002, 'Not in a room');

                // Store peer's E2EE public key and broadcast to others
                const peer = room.peers.get(connectionState.peerId!);
                if (!peer) throw createError(-32002, 'Peer not found');

                (peer as any).e2eePublicKey = publicKey;

                roomManager.broadcast(connectionState.roomId!, 'e2eeKeyExchange', {
                    peerId: connectionState.peerId,
                    publicKey,
                }, connectionState.peerId!);

                return {
                    jsonrpc: '2.0', id: id!,
                    result: { registered: true },
                };
            }

            case 'distributeEpochKey': {
                const { targetPeerId, encryptedKey, epoch } = params;
                const room = roomManager.getRoom(connectionState.roomId!);
                if (!room) throw createError(-32002, 'Not in a room');

                // Forward encrypted epoch key to specific peer
                const targetPeer = room.peers.get(targetPeerId);
                if (targetPeer && (targetPeer as any).ws) {
                    const notification = JSON.stringify({
                        jsonrpc: '2.0',
                        method: 'e2eeEpochKey',
                        params: {
                            fromPeerId: connectionState.peerId,
                            encryptedKey,
                            epoch,
                        },
                    });
                    (targetPeer as any).ws.send(notification);
                }

                return {
                    jsonrpc: '2.0', id: id!,
                    result: { delivered: true },
                };
            }

            case 'e2eeRekey': {
                // Triggered when a participant leaves and host re-keys
                const room = roomManager.getRoom(connectionState.roomId!);
                if (!room) throw createError(-32002, 'Not in a room');

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
    beforeRegister?: () => void
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
        role: 'member',
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
            producers: Array.from(p.producers.values()),
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
        sfuAvailable,
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
    connectionState: { peerId?: string; roomId?: string; displayName?: string; authUser?: { sub: string; role?: string } | null }
): Promise<void> {
    const { peerId, roomId, displayName } = connectionState;
    if (!peerId || !roomId) return;

    try {
        await sfuClient.removePeer(roomId, peerId).catch(() => { });

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

function createError(code: number, message: string): Error & { code: number } {
    const err = new Error(message) as Error & { code: number };
    err.code = code;
    return err;
}
