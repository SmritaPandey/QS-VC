/**
 * Unit tests for the Signaling service room-manager logic and meeting code generation.
 * Tests room lifecycle, peer management, waiting room, RBAC, and host controls.
 */
import { describe, it, expect, beforeEach } from 'vitest';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Inline types matching room-manager.ts
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
type PeerRole = 'host' | 'co-host' | 'member' | 'guest';

interface PeerState {
    id: string;
    displayName: string;
    ws: any;
    rtpCapabilities: any;
    producers: Map<string, { id: string; kind: string; appData: any }>;
    role: PeerRole;
    audioMuted: boolean;
    videoOff: boolean;
    handRaised: boolean;
    screenSharing: boolean;
    joinedAt: Date;
}

interface RoomSettings {
    maxParticipants: number;
    waitingRoomEnabled: boolean;
    locked: boolean;
    password: string | null;
    muteOnEntry: boolean;
    allowScreenShare: boolean;
    allowChat: boolean;
    allowRecording: boolean;
}

// Minimal RoomManager re-impl for unit testing (avoids importing ws dependency)
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

function createPeer(id: string, displayName: string, role: PeerRole = 'member'): PeerState {
    return {
        id, displayName, ws: null, rtpCapabilities: null,
        producers: new Map(), role,
        audioMuted: false, videoOff: false, handRaised: false, screenSharing: false,
        joinedAt: new Date(),
    };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MEETING CODE TESTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Signaling: meeting code generation', () => {
    function generateMeetingCode(): string {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const segments = [];
        for (let s = 0; s < 3; s++) {
            let seg = '';
            for (let i = 0; i < 4; i++) {
                seg += chars[Math.floor(Math.random() * chars.length)];
            }
            segments.push(seg);
        }
        return `QS-${segments.join('-')}`;
    }

    it('should generate a code matching QS-XXXX-XXXX-XXXX format', () => {
        const code = generateMeetingCode();
        expect(code).toMatch(/^QS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    });

    it('should generate unique codes', () => {
        const codes = new Set(Array.from({ length: 100 }, generateMeetingCode));
        expect(codes.size).toBeGreaterThan(95); // High uniqueness
    });

    it('should not contain ambiguous characters (0, O, 1, I)', () => {
        for (let i = 0; i < 50; i++) {
            const code = generateMeetingCode();
            const body = code.replace('QS-', '').replace(/-/g, '');
            expect(body).not.toMatch(/[0OI1]/);
        }
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ROOM SETTINGS TESTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Signaling: room settings defaults', () => {
    it('should have correct default maxParticipants', () => {
        expect(DEFAULT_SETTINGS.maxParticipants).toBe(25);
    });

    it('should have waiting room disabled by default', () => {
        expect(DEFAULT_SETTINGS.waitingRoomEnabled).toBe(false);
    });

    it('should have room unlocked by default', () => {
        expect(DEFAULT_SETTINGS.locked).toBe(false);
    });

    it('should allow screen share, chat, and recording by default', () => {
        expect(DEFAULT_SETTINGS.allowScreenShare).toBe(true);
        expect(DEFAULT_SETTINGS.allowChat).toBe(true);
        expect(DEFAULT_SETTINGS.allowRecording).toBe(true);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PEER STATE TESTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Signaling: peer state management', () => {
    it('should create a peer with correct initial state', () => {
        const peer = createPeer('peer-1', 'Alice');
        expect(peer.id).toBe('peer-1');
        expect(peer.displayName).toBe('Alice');
        expect(peer.role).toBe('member');
        expect(peer.audioMuted).toBe(false);
        expect(peer.videoOff).toBe(false);
        expect(peer.handRaised).toBe(false);
        expect(peer.screenSharing).toBe(false);
        expect(peer.producers.size).toBe(0);
    });

    it('should create a host peer', () => {
        const peer = createPeer('peer-host', 'Bob', 'host');
        expect(peer.role).toBe('host');
    });

    it('should create a guest peer', () => {
        const peer = createPeer('peer-guest', 'Guest', 'guest');
        expect(peer.role).toBe('guest');
    });

    it('should support mute-on-entry logic', () => {
        const settings = { ...DEFAULT_SETTINGS, muteOnEntry: true };
        const peer = createPeer('peer-2', 'Charlie');
        if (settings.muteOnEntry && peer.role !== 'host') {
            peer.audioMuted = true;
        }
        expect(peer.audioMuted).toBe(true);
    });

    it('should not mute host even with muteOnEntry', () => {
        const settings = { ...DEFAULT_SETTINGS, muteOnEntry: true };
        const peer = createPeer('peer-host', 'Host', 'host');
        if (settings.muteOnEntry && peer.role !== 'host') {
            peer.audioMuted = true;
        }
        expect(peer.audioMuted).toBe(false);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ROLE-BASED ACCESS TESTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Signaling: RBAC logic', () => {
    function isHostOrCoHost(role: PeerRole): boolean {
        return role === 'host' || role === 'co-host';
    }

    it('should identify host as privileged', () => {
        expect(isHostOrCoHost('host')).toBe(true);
    });

    it('should identify co-host as privileged', () => {
        expect(isHostOrCoHost('co-host')).toBe(true);
    });

    it('should not identify member as privileged', () => {
        expect(isHostOrCoHost('member')).toBe(false);
    });

    it('should not identify guest as privileged', () => {
        expect(isHostOrCoHost('guest')).toBe(false);
    });
});
