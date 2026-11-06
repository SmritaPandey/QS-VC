import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger.js';

/**
 * Enhanced room registry with waiting room, host controls, RBAC, and media stats.
 */

export type PeerRole = 'host' | 'co-host' | 'member' | 'guest';
export const MAX_CO_HOSTS = 5;

export interface PeerState {
    id: string;
    displayName: string;
    userId?: string;
    /** Platform admin (server-verified): joins any meeting with host controls. */
    platformAdmin?: boolean;
    ws: any; // WebSocket reference
    rtpCapabilities: any;
    producers: Map<string, { id: string; kind: string; appData: any }>;
    role: PeerRole;
    audioMuted: boolean;
    videoOff: boolean;
    handRaised: boolean;
    screenSharing: boolean;
    joinedAt: Date;
}

export interface VerifiedSignalingUser {
    sub: string;
    role?: string;
    plan?: 'guest' | 'starter_trial' | 'starter' | 'pro' | 'enterprise';
    status?: 'trial_active' | 'trial_expired' | 'paid_active' | 'enterprise_pending' | 'enterprise_approved' | 'enterprise_rejected';
    privateConversationLimitMs?: number | null;
}

export interface WaitingPeer {
    id: string;
    displayName: string;
    ws: any;
    rtpCapabilities: any;
    requestedAt: Date;
    /** Signed-in user (kept so admission preserves the account and its rights). */
    authUser?: VerifiedSignalingUser | null;
    /** True while the meeting has not been started by its host (Google Meet "waiting for the host"). */
    awaitingHost?: boolean;
    /** Valid invitation link holder; identifies the link path but does not bypass host admission. */
    invited?: boolean;
    /** Host or co-host has acknowledged the request while leaving the attendee in this queue. */
    reviewedAt?: Date;
}

export interface PrivateConversation {
    id: string;
    initiatorPeerId: string;
    targetPeerId: string;
    status: 'invited' | 'activating' | 'active';
    durationMs: number | null;
    startedAt: number | null;
    endsAt: number | null;
    previousAudioMuted?: Record<string, boolean>;
    privateAudioMuted?: Record<string, boolean>;
    timer?: ReturnType<typeof setTimeout>;
}

export interface RoomSettings {
    webinar?: boolean;
    meetingKind: 'conference' | 'team' | 'town_hall';
    maxParticipants: number;       // default 25
    waitingRoomEnabled: boolean;   // host approval is required for every non-host attendee
    locked: boolean;               // no new joins
    password: string | null;       // meeting password
    muteOnEntry: boolean;          // mute mic on join
    allowScreenShare: boolean;     // allow screen sharing
    allowChat: boolean;            // allow chat
    allowRecording: boolean;       // allow recording
    // Host management (Google Meet style): what participants (not hosts/co-hosts) may do.
    allowMicrophone: boolean;      // participants can turn on their mic
    allowCamera: boolean;          // participants can turn on their camera
    allowReactions: boolean;       // participants can send reactions
}

export interface PersistentRoomOptions {
    ownerUserId?: string;
    autoAdmit?: boolean;
    maxParticipants?: number;
    encryption?: 'required' | 'optional';
    displayName?: string;
}

export interface RoomState {
    id: string;
    meetingCode: string;
    hostPeerId: string | null;
    ownerUserId?: string | null;
    peers: Map<string, PeerState>;
    waitingRoom: Map<string, WaitingPeer>;
    settings: RoomSettings;
    recording: { peerId: string; displayName: string } | null;
    /** Set once the host (or a platform admin) has joined. Until then nobody else gets in. */
    hostStarted: boolean;
    /** Host-chosen participant shown large for everyone ("Spotlight for everyone"). */
    spotlightPeerId: string | null;
    /** Webinar attendees the host invited on stage: they may turn on mic, camera and share. */
    stage: Set<string>;
    /** Active and pending pair-only audio sessions. */
    privateConversations: Map<string, PrivateConversation>;
    createdAt: Date;
}

const DEFAULT_SETTINGS: RoomSettings = {
    maxParticipants: 25,
    waitingRoomEnabled: true,
    meetingKind: 'conference',
    locked: false,
    password: null,
    muteOnEntry: false,
    allowScreenShare: true,
    allowChat: true,
    allowRecording: true,
    allowMicrophone: true,
    allowCamera: true,
    allowReactions: true,
};

class RoomManager {
    private rooms: Map<string, RoomState> = new Map();
    private codeToRoomId: Map<string, string> = new Map();

    /** Create or get a room by meeting code. */
    getOrCreateRoom(meetingCode: string, settings?: Partial<RoomSettings>): RoomState {
        const existingId = this.codeToRoomId.get(meetingCode);
        if (existingId) {
            const room = this.rooms.get(existingId);
            if (room) return room;
        }

        const roomId = uuidv4();
        const meetingKind = settings?.meetingKind ?? (settings?.webinar ? 'town_hall' : 'conference');
        const room: RoomState = {
            id: roomId,
            meetingCode,
            hostPeerId: null,
            peers: new Map(),
            waitingRoom: new Map(),
            settings: {
                ...DEFAULT_SETTINGS,
                ...settings,
                meetingKind,
                webinar: meetingKind === 'town_hall',
                waitingRoomEnabled: true,
            },
            recording: null,
            hostStarted: false,
            spotlightPeerId: null,
            stage: new Set(),
            privateConversations: new Map(),
            createdAt: new Date(),
        };

        this.rooms.set(roomId, room);
        this.codeToRoomId.set(meetingCode, roomId);
        logger.info(`Room created: ${meetingCode} (${roomId})`);
        return room;
    }

    /**
     * Create or get a persistent room for an assigned number / stable meeting code.
     * Persistent rooms allow callers (e.g. SIP/Polycom devices or dialed callers)
     * to enter immediately without waiting for a browser host to arrive first.
     */
    getOrCreatePersistentRoom(meetingCode: string, opts?: PersistentRoomOptions): RoomState {
        const existingId = this.codeToRoomId.get(meetingCode);
        if (existingId) {
            const room = this.rooms.get(existingId);
            if (room) {
                if (opts?.autoAdmit !== undefined) {
                    room.settings.waitingRoomEnabled = !opts.autoAdmit;
                }
                // Persistent rooms remain active even when attendees must wait.
                room.hostStarted = true;
                return room;
            }
        }

        const autoAdmit = opts?.autoAdmit ?? true;
        const room = this.getOrCreateRoom(meetingCode, {
            maxParticipants: opts?.maxParticipants ?? 100,
            waitingRoomEnabled: !autoAdmit,
        });

        room.ownerUserId = opts?.ownerUserId ?? null;
        room.hostStarted = true;
        room.settings.waitingRoomEnabled = !autoAdmit;

        logger.info(`Persistent room created: ${meetingCode} (${room.id}), autoAdmit=${autoAdmit}`);
        return room;
    }

    getRoom(roomId: string): RoomState | undefined {
        return this.rooms.get(roomId);
    }

    getRoomByCode(meetingCode: string): RoomState | undefined {
        const roomId = this.codeToRoomId.get(meetingCode);
        return roomId ? this.rooms.get(roomId) : undefined;
    }

    /** Add peer to the active room (post waiting room). */
    addPeer(roomId: string, peer: PeerState): void {
        const room = this.rooms.get(roomId);
        if (!room) throw new Error(`Room ${roomId} not found`);

        if (!peer.platformAdmin && room.peers.size >= room.settings.maxParticipants) {
            throw new Error('Room is full');
        }

        if (room.settings.locked && !peer.platformAdmin && !(room.ownerUserId && room.ownerUserId === peer.userId)) {
            throw new Error('Room is locked');
        }

        // Roles on join are server-owned. Only the host can promote an existing member.
        peer.role = 'member';
        // First peer becomes host
        if ((!room.ownerUserId && !room.hostPeerId) || (!!room.ownerUserId && room.ownerUserId === peer.userId && ![...room.peers.values()].some(p => p.userId === peer.userId && p.role === 'host'))) {
            peer.role = 'host';
            room.hostPeerId = peer.id;
        }
        // Platform admins get host controls without creating a second host.
        if (peer.platformAdmin && peer.role !== 'host') {
            if (!room.hostPeerId) {
                peer.role = 'host';
                room.hostPeerId = peer.id;
            } else if ([...room.peers.values()].filter(other => other.role === 'co-host').length < MAX_CO_HOSTS) {
                peer.role = 'co-host';
            }
        }
        // The owner is back: a co-host who covered while they were away returns to co-host.
        if (peer.role === 'host' && room.ownerUserId && room.ownerUserId === peer.userId) {
            for (const other of room.peers.values()) {
                if (other.role === 'host' && other.id !== peer.id) {
                    const coHostCount = [...room.peers.values()].filter(p => p.role === 'co-host').length;
                    other.role = coHostCount < MAX_CO_HOSTS ? 'co-host' : 'member';
                    this.broadcast(roomId, 'roleChanged', { peerId: other.id, role: other.role, displayName: other.displayName });
                }
            }
            room.hostPeerId = peer.id;
        }
        if (peer.role === 'host') room.hostStarted = true;

        // Apply mute-on-entry
        if (room.settings.muteOnEntry && peer.role !== 'host') {
            peer.audioMuted = true;
        }

        room.peers.set(peer.id, peer);
        logger.info(`Peer ${peer.id} (${peer.displayName}, ${peer.role}) joined room ${room.meetingCode} [total: ${room.peers.size}]`);
    }

    /** Add peer to waiting room. */
    addToWaitingRoom(roomId: string, waiting: WaitingPeer): void {
        const room = this.rooms.get(roomId);
        if (!room) throw new Error(`Room ${roomId} not found`);
        room.waitingRoom.set(waiting.id, waiting);
        logger.info(`Peer ${waiting.id} (${waiting.displayName}) in waiting room for ${room.meetingCode}`);
    }

    /** Admit a peer from waiting room to active room. */
    admitFromWaitingRoom(roomId: string, waitingPeerId: string): WaitingPeer | undefined {
        const room = this.rooms.get(roomId);
        if (!room) return undefined;
        const waiting = room.waitingRoom.get(waitingPeerId);
        if (waiting) {
            room.waitingRoom.delete(waitingPeerId);
        }
        return waiting;
    }

    /** Reject a peer from waiting room. */
    rejectFromWaitingRoom(roomId: string, waitingPeerId: string): WaitingPeer | undefined {
        const room = this.rooms.get(roomId);
        if (!room) return undefined;
        const waiting = room.waitingRoom.get(waitingPeerId);
        if (waiting) {
            room.waitingRoom.delete(waitingPeerId);
        }
        return waiting;
    }

    /** Admit all waiting room peers. */
    admitAllFromWaitingRoom(roomId: string): WaitingPeer[] {
        const room = this.rooms.get(roomId);
        if (!room) return [];
        const all = Array.from(room.waitingRoom.values());
        room.waitingRoom.clear();
        return all;
    }

    /** Get waiting room list. */
    getWaitingRoom(roomId: string): WaitingPeer[] {
        const room = this.rooms.get(roomId);
        if (!room) return [];
        return Array.from(room.waitingRoom.values());
    }

    removePeer(roomId: string, peerId: string): PeerState | undefined {
        const room = this.rooms.get(roomId);
        if (!room) return undefined;

        const peer = room.peers.get(peerId);
        room.peers.delete(peerId);
        room.waitingRoom.delete(peerId);
        if (room.recording?.peerId === peerId) this.updateRecording(roomId, null);
        room.stage.delete(peerId);
        if (room.spotlightPeerId === peerId) {
            room.spotlightPeerId = null;
            this.broadcast(roomId, 'spotlightChanged', { peerId: null });
        }

        // Host left. Owned meetings keep running (like Google Meet) and only a co-host takes over;
        // nobody else is promoted. Ad-hoc rooms without an owner hand over to the longest-present peer.
        if (room.hostPeerId === peerId && room.peers.size > 0) {
            room.hostPeerId = null;
            const others = [...room.peers.values()];
            const nextHost = others.find(p => p.role === 'host')
                || others.find(p => p.role === 'co-host')
                || (room.ownerUserId ? undefined : others.find(p => !!p.userId) || others[0]);
            if (nextHost) {
                nextHost.role = 'host';
                room.hostPeerId = nextHost.id;
                logger.info(`Host transferred to ${nextHost.displayName} in ${room.meetingCode}`);
                this.sendToPeer(roomId, nextHost.id, 'hostTransferred', { newHostId: nextHost.id });
                this.broadcast(roomId, 'roleChanged', { peerId: nextHost.id, role: 'host' });
            } else {
                // The meeting carries on without host controls until the host or a co-host is back.
                this.broadcast(roomId, 'hostLeft', { hasHost: false });
            }
        }

        if (room.peers.size === 0) room.hostPeerId = null;

        if (room.peers.size === 0 && room.waitingRoom.size === 0) {
            setTimeout(() => {
                const r = this.rooms.get(roomId);
                if (r && r.peers.size === 0 && r.waitingRoom.size === 0) {
                    this.rooms.delete(roomId);
                    this.codeToRoomId.delete(room.meetingCode);
                    logger.info(`Room ${room.meetingCode} removed (empty)`);
                }
            }, 60000);
        }
        if (room.peers.size === 0 && room.ownerUserId && room.settings.waitingRoomEnabled) {
            // Everyone in the call left; the next person in must wait for the host again.
            room.hostStarted = false;
            for (const waiting of room.waitingRoom.values()) {
                waiting.awaitingHost = true;
                if (waiting.ws?.readyState === 1) waiting.ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'waitingStatus', params: { status: 'waitingForHost' } }));
            }
        }
        return peer;
    }

    /** Check if peer is host or co-host. */
    isHostOrCoHost(roomId: string, peerId: string): boolean {
        const room = this.rooms.get(roomId);
        if (!room) return false;
        const peer = room.peers.get(peerId);
        return peer?.role === 'host' || peer?.role === 'co-host';
    }

    /** Update room settings (host only). */
    updateSettings(roomId: string, settings: Partial<RoomSettings>): void {
        const room = this.rooms.get(roomId);
        if (!room) return;
        if (settings.waitingRoomEnabled === false) throw new Error('Host approval is required for every attendee.');
        Object.assign(room.settings, settings, { waitingRoomEnabled: true });
        if (!room.settings.allowRecording && room.recording) this.updateRecording(roomId, null);
        this.broadcast(roomId, 'settingsUpdated', { settings: { ...room.settings, password: undefined } });
    }

    updateRecording(roomId: string, recording: RoomState['recording']): void {
        const room = this.rooms.get(roomId);
        if (!room) return;
        room.recording = recording;
        this.broadcast(roomId, 'recordingStateChanged', { recording });
    }

    /** Promote/demote peer role (host only). */
    changePeerRole(roomId: string, targetPeerId: string, newRole: PeerRole): void {
        const room = this.rooms.get(roomId);
        if (!room) return;
        const peer = room.peers.get(targetPeerId);
        if (!peer) return;
        if (newRole === 'host' && [...room.peers.values()].some(other => other.id !== targetPeerId && other.role === 'host')) {
            throw new Error('A meeting can have only one host.');
        }
        if (newRole === 'co-host' && peer.role !== 'co-host' && [...room.peers.values()].filter(other => other.role === 'co-host').length >= MAX_CO_HOSTS) {
            throw new Error(`A meeting can have up to ${MAX_CO_HOSTS} co-hosts.`);
        }
        peer.role = newRole;
        if (newRole === 'host') room.hostPeerId = targetPeerId;
        if (newRole !== 'host' && room.recording?.peerId === targetPeerId) this.updateRecording(roomId, null);
        this.broadcast(roomId, 'roleChanged', { peerId: targetPeerId, role: newRole, displayName: peer.displayName });
    }

    keepWaiting(roomId: string, peerId: string): WaitingPeer | undefined {
        const waiting = this.rooms.get(roomId)?.waitingRoom.get(peerId);
        if (!waiting || waiting.awaitingHost) return undefined;
        waiting.reviewedAt = new Date();
        this.broadcast(roomId, 'waitingRoomUpdated', { peerId, reviewed: true });
        return waiting;
    }

    /** Broadcast a JSON-RPC notification to all peers in a room except the sender. */
    broadcast(roomId: string, method: string, params: any, excludePeerId?: string): void {
        const room = this.rooms.get(roomId);
        if (!room) return;

        const message = JSON.stringify({ jsonrpc: '2.0', method, params });

        for (const [peerId, peer] of room.peers) {
            if (peerId === excludePeerId) continue;
            try {
                if (peer.ws && peer.ws.readyState === 1) {
                    peer.ws.send(message);
                }
            } catch (err) {
                logger.error(err, `Failed to broadcast to peer ${peerId}`);
            }
        }
    }

    /** Send a JSON-RPC notification to a specific peer. */
    sendToPeer(roomId: string, peerId: string, method: string, params: any): void {
        const room = this.rooms.get(roomId);
        if (!room) return;

        const peer = room.peers.get(peerId);
        if (!peer || !peer.ws || peer.ws.readyState !== 1) return;

        peer.ws.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
    }

    getRoomCount(): number {
        return this.rooms.size;
    }
}

export const roomManager = new RoomManager();
