import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger.js';

/**
 * Enhanced room registry with waiting room, host controls, RBAC, and media stats.
 */

export type PeerRole = 'host' | 'co-host' | 'member' | 'guest';

export interface PeerState {
    id: string;
    displayName: string;
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
}

export interface RoomSettings {
    maxParticipants: number;       // default 25
    waitingRoomEnabled: boolean;   // default false
    locked: boolean;               // no new joins
    password: string | null;       // meeting password
    muteOnEntry: boolean;          // mute mic on join
    allowScreenShare: boolean;     // allow screen sharing
    allowChat: boolean;            // allow chat
    allowRecording: boolean;       // allow recording
}

export interface RoomState {
    id: string;
    meetingCode: string;
    hostPeerId: string | null;
    peers: Map<string, PeerState>;
    waitingRoom: Map<string, WaitingPeer>;
    settings: RoomSettings;
    createdAt: Date;
}

const DEFAULT_SETTINGS: RoomSettings = {
    maxParticipants: 25,
    waitingRoomEnabled: false,
    locked: false,
    password: null,
    muteOnEntry: false,
    allowScreenShare: true,
    allowChat: true,
    allowRecording: true,
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

        if (room.peers.size >= room.settings.maxParticipants) {
            throw new Error('Room is full');
        }

        if (room.settings.locked && peer.role !== 'host') {
            throw new Error('Room is locked');
        }

        // First peer becomes host
        if (!room.hostPeerId) {
            peer.role = 'host';
            room.hostPeerId = peer.id;
        }

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

        // Transfer host role if host left
        if (room.hostPeerId === peerId && room.peers.size > 0) {
            const nextHost = room.peers.values().next().value;
            if (nextHost) {
                nextHost.role = 'host';
                room.hostPeerId = nextHost.id;
                logger.info(`Host transferred to ${nextHost.displayName} in ${room.meetingCode}`);
                this.sendToPeer(roomId, nextHost.id, 'hostTransferred', { newHostId: nextHost.id });
                this.broadcast(roomId, 'roleChanged', { peerId: nextHost.id, role: 'host' });
            }
        }

        if (room.peers.size === 0 && room.waitingRoom.size === 0) {
            setTimeout(() => {
                const r = this.rooms.get(roomId);
                if (r && r.peers.size === 0) {
                    this.rooms.delete(roomId);
                    this.codeToRoomId.delete(room.meetingCode);
                    logger.info(`Room ${room.meetingCode} removed (empty)`);
                }
            }, 60000);
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
        this.broadcast(roomId, 'settingsUpdated', { settings: room.settings });
    }

    /** Promote/demote peer role (host only). */
    changePeerRole(roomId: string, targetPeerId: string, newRole: PeerRole): void {
        const room = this.rooms.get(roomId);
        if (!room) return;
        const peer = room.peers.get(targetPeerId);
        if (!peer) return;
        peer.role = newRole;
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
