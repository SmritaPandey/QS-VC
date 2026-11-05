import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger.js';

/**
 * Enhanced room registry with waiting room, host controls, RBAC, and media stats.
 */

export type PeerRole = 'host' | 'co-host' | 'member' | 'guest';

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

export interface WaitingPeer {
    id: string;
    displayName: string;
    ws: any;
    rtpCapabilities: any;
    requestedAt: Date;
    /** Signed-in user (kept so admission preserves the account and its rights). */
    authUser?: { sub: string; role?: string } | null;
    /** True while the meeting has not been started by its host (Google Meet "waiting for the host"). */
    awaitingHost?: boolean;
    /** Valid invitation link holder; may bypass the admission queue after the host starts. */
    invited?: boolean;
}

export interface RoomSettings {
    webinar?: boolean;
    maxParticipants: number;       // default 25
    waitingRoomEnabled: boolean;   // default false
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
    createdAt: Date;
}

const DEFAULT_SETTINGS: RoomSettings = {
    maxParticipants: 25,
    waitingRoomEnabled: true,
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
        const room: RoomState = {
            id: roomId,
            meetingCode,
            hostPeerId: null,
            peers: new Map(),
            waitingRoom: new Map(),
            settings: { ...DEFAULT_SETTINGS, ...settings },
            recording: null,
            hostStarted: false,
            spotlightPeerId: null,
            stage: new Set(),
            createdAt: new Date(),
        };

        this.rooms.set(roomId, room);
        this.codeToRoomId.set(meetingCode, roomId);
        logger.info(`Room created: ${meetingCode} (${roomId})`);
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
        // Platform admins always get host controls (mute, remove, lock, record, end) in any meeting.
        if (peer.platformAdmin && peer.role !== 'host') {
            peer.role = 'host';
            if (!room.hostPeerId) room.hostPeerId = peer.id;
        }
        // The owner is back: a co-host who covered while they were away returns to co-host.
        if (peer.role === 'host' && room.ownerUserId && room.ownerUserId === peer.userId) {
            for (const other of room.peers.values()) {
                if (other.role === 'host' && other.userId !== peer.userId && !other.platformAdmin) {
                    other.role = 'co-host';
                    this.broadcast(roomId, 'roleChanged', { peerId: other.id, role: 'co-host', displayName: other.displayName });
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
        if (room.peers.size === 0 && room.ownerUserId) {
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
        Object.assign(room.settings, settings);
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
        peer.role = newRole;
        if (newRole !== 'host' && room.recording?.peerId === targetPeerId) this.updateRecording(roomId, null);
        this.broadcast(roomId, 'roleChanged', { peerId: targetPeerId, role: newRole, displayName: peer.displayName });
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
