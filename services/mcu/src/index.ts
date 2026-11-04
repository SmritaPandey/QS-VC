/**
 * MCU (Multipoint Control Unit) Service for QS-VC Enterprise/Intranet.
 *
 * LEGACY CONTROL-ONLY PLACEHOLDER. This package has no media engine. Enterprise
 * media integration is provided by deploy/poly-bridge connected to FreeSWITCH.
 *
 * The in-memory state below is retained for compatibility only. It must not
 * report or imply that any audio/video media operation succeeded.
 *
 * Deployment: On-premise (air-gapped) or hybrid
 * Network: MPLS VPN / IPSec VPN / Private WAN
 *
 * This service runs alongside the SFU and is selected based on:
 * - Deployment mode (SaaS = SFU, Enterprise = MCU)
 * - Meeting size (>50 participants → MCU composition)
 * - Legacy endpoints (SIP/H.323 → MCU bridge)
 * - Bandwidth constraints (MPLS → MCU single composite)
 */
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MCU TYPES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type CompositionLayout =
    | 'grid'            // Equal-size tiles in grid
    | 'speaker'         // Active speaker large + others small
    | 'presentation'    // Screen share large + participants strip
    | 'spotlight'       // Single speaker full screen
    | 'filmstrip'       // Horizontal strip at bottom
    | 'custom';         // Admin-defined layout

export type VideoCodec = 'h264' | 'h265' | 'vp8' | 'vp9' | 'av1';
export type AudioCodec = 'opus' | 'pcma' | 'pcmu' | 'g722' | 'aac';

export interface MCUConfig {
    port: number;
    maxRooms: number;
    maxParticipantsPerRoom: number;
    defaultLayout: CompositionLayout;
    outputResolution: { width: number; height: number };
    outputFps: number;
    outputVideoBitrate: number;     // kbps
    outputAudioBitrate: number;     // kbps
    outputVideoCodec: VideoCodec;
    outputAudioCodec: AudioCodec;
    recordingEnabled: boolean;
    recordingPath: string;
    sipEnabled: boolean;
    sipPort: number;
    h323Enabled: boolean;
    h323Port: number;
    rtmpEnabled: boolean;
}

const DEFAULT_MCU_CONFIG: MCUConfig = {
    port: parseInt(process.env.MCU_PORT || '4005'),
    maxRooms: 100,
    maxParticipantsPerRoom: 500,
    defaultLayout: 'speaker',
    outputResolution: { width: 1920, height: 1080 },
    outputFps: 30,
    outputVideoBitrate: 4000,
    outputAudioBitrate: 128,
    outputVideoCodec: 'h264',
    outputAudioCodec: 'opus',
    recordingEnabled: false,
    recordingPath: './recordings',
    sipEnabled: false,
    sipPort: 5060,
    h323Enabled: false,
    h323Port: 1720,
    rtmpEnabled: false,
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MCU ROOM STATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface MCUParticipant {
    id: string;
    displayName: string;
    connectionType: 'webrtc' | 'sip' | 'h323' | 'rtmp';
    videoEnabled: boolean;
    audioEnabled: boolean;
    isActiveSpeaker: boolean;
    isPresenting: boolean;
    inputCodec: { video: VideoCodec; audio: AudioCodec };
    position: { row: number; col: number };  // Grid position
    joinedAt: Date;
}

interface MCURoom {
    id: string;
    meetingCode: string;
    layout: CompositionLayout;
    participants: Map<string, MCUParticipant>;
    recording: boolean;
    recordingPath: string | null;
    compositionState: {
        outputResolution: { width: number; height: number };
        fps: number;
        activeSpeakerId: string | null;
        presenterId: string | null;
    };
    createdAt: Date;
    sipDialInNumber?: string;
    sipConferenceId?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MCU PIPELINE (GStreamer abstraction)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class MCUPipeline {
    private rooms: Map<string, MCURoom> = new Map();
    private config: MCUConfig;

    constructor(config: MCUConfig = DEFAULT_MCU_CONFIG) {
        this.config = config;
    }

    /** Create or get an MCU room. */
    getOrCreateRoom(meetingCode: string): MCURoom {
        for (const room of this.rooms.values()) {
            if (room.meetingCode === meetingCode) return room;
        }

        if (this.rooms.size >= this.config.maxRooms) {
            throw new Error('Maximum MCU rooms reached');
        }

        const room: MCURoom = {
            id: uuidv4(),
            meetingCode,
            layout: this.config.defaultLayout,
            participants: new Map(),
            recording: false,
            recordingPath: null,
            compositionState: {
                outputResolution: { ...this.config.outputResolution },
                fps: this.config.outputFps,
                activeSpeakerId: null,
                presenterId: null,
            },
            createdAt: new Date(),
        };

        this.rooms.set(room.id, room);
        console.log(`[MCU] Room created: ${meetingCode} (${room.id})`);

        return room;
    }

    getRoom(roomId: string): MCURoom | undefined {
        return this.rooms.get(roomId);
    }

    /** Add participant to MCU room. */
    addParticipant(
        roomId: string,
        peerId: string,
        displayName: string,
        connectionType: MCUParticipant['connectionType'] = 'webrtc'
    ): MCUParticipant {
        const room = this.rooms.get(roomId);
        if (!room) throw new Error('Room not found');

        if (room.participants.size >= this.config.maxParticipantsPerRoom) {
            throw new Error('Room is full');
        }

        const participant: MCUParticipant = {
            id: peerId,
            displayName,
            connectionType,
            videoEnabled: true,
            audioEnabled: true,
            isActiveSpeaker: room.participants.size === 0, // First joiner is active speaker
            isPresenting: false,
            inputCodec: {
                video: connectionType === 'h323' ? 'h264' : 'vp9',
                audio: connectionType === 'sip' ? 'pcma' : 'opus',
            },
            position: this.calculateGridPosition(room),
            joinedAt: new Date(),
        };

        room.participants.set(peerId, participant);
        this.recalculateLayout(room);

        console.log(`[MCU] Participant added: ${displayName} (${connectionType}) to room ${room.meetingCode}`);
        return participant;
    }

    /** Remove participant. */
    removeParticipant(roomId: string, peerId: string): void {
        const room = this.rooms.get(roomId);
        if (!room) return;

        room.participants.delete(peerId);
        this.recalculateLayout(room);

        if (room.participants.size === 0) {
            setTimeout(() => {
                const r = this.rooms.get(roomId);
                if (r && r.participants.size === 0) {
                    this.rooms.delete(roomId);
                    console.log(`[MCU] Room removed: ${room.meetingCode}`);
                }
            }, 60_000);
        }
    }

    /** Set composition layout. */
    setLayout(roomId: string, layout: CompositionLayout): void {
        const room = this.rooms.get(roomId);
        if (!room) throw new Error('Room not found');
        room.layout = layout;
        this.recalculateLayout(room);
        console.log(`[MCU] Layout changed to ${layout} in room ${room.meetingCode}`);
    }

    /** Set active speaker (for speaker layout). */
    setActiveSpeaker(roomId: string, peerId: string): void {
        const room = this.rooms.get(roomId);
        if (!room) return;

        for (const [id, p] of room.participants) {
            p.isActiveSpeaker = id === peerId;
        }
        room.compositionState.activeSpeakerId = peerId;
    }

    stopRecording(roomId: string): string | null {
        const room = this.rooms.get(roomId);
        if (!room) return null;

        room.recording = false;
        const path = room.recordingPath;
        room.recordingPath = null;
        console.log(`[MCU] Recording stopped: ${path}`);
        return path;
    }

    /** Start RTMP live stream. */
    startLiveStream(roomId: string, rtmpUrl: string): void {
        const room = this.rooms.get(roomId);
        if (!room) throw new Error('Room not found');
        console.log(`[MCU] Live stream started to ${rtmpUrl} for room ${room.meetingCode}`);
        // In production: GStreamer rtmpsink pipeline
    }

    // ── Internal ────────────────────────────────────────

    private calculateGridPosition(room: MCURoom): { row: number; col: number } {
        const count = room.participants.size;
        const cols = Math.ceil(Math.sqrt(count + 1));
        return { row: Math.floor(count / cols), col: count % cols };
    }

    private recalculateLayout(room: MCURoom): void {
        const participants = Array.from(room.participants.values());
        const count = participants.length;
        const cols = Math.ceil(Math.sqrt(count));

        participants.forEach((p, i) => {
            p.position = { row: Math.floor(i / cols), col: i % cols };
        });
    }

    /** Get room status. */
    getRoomInfo(roomId: string): any {
        const room = this.rooms.get(roomId);
        if (!room) return null;

        return {
            id: room.id,
            meetingCode: room.meetingCode,
            layout: room.layout,
            participantCount: room.participants.size,
            participants: Array.from(room.participants.values()).map(p => ({
                id: p.id,
                displayName: p.displayName,
                connectionType: p.connectionType,
                isActiveSpeaker: p.isActiveSpeaker,
                isPresenting: p.isPresenting,
                videoEnabled: p.videoEnabled,
                audioEnabled: p.audioEnabled,
                position: p.position,
            })),
            recording: room.recording,
            compositionState: room.compositionState,
            sipDialIn: room.sipDialInNumber,
            sipConferenceId: room.sipConferenceId,
            uptime: Date.now() - room.createdAt.getTime(),
        };
    }

    /** Get all rooms. */
    getAllRooms(): any[] {
        return Array.from(this.rooms.values()).map(r => ({
            id: r.id,
            meetingCode: r.meetingCode,
            participantCount: r.participants.size,
            layout: r.layout,
            recording: r.recording,
        }));
    }

    getRoomCount(): number {
        return this.rooms.size;
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MCU REST API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

const mcuPipeline = new MCUPipeline();

// Validation schemas
const joinMCURoomSchema = z.object({
    meetingCode: z.string().min(1).max(30),
    peerId: z.string().min(1).max(128),
    displayName: z.string().min(1).max(100),
    connectionType: z.enum(['webrtc', 'sip', 'h323', 'rtmp']).default('webrtc'),
});

const layoutSchema = z.object({
    layout: z.enum(['grid', 'speaker', 'presentation', 'spotlight', 'filmstrip', 'custom']),
});

// Health check
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        service: 'qsvc-mcu',
        rooms: mcuPipeline.getRoomCount(),
        mediaReady: false,
        mode: 'control-only',
        capabilities: { sipEnabled: false, h323Enabled: false, rtmpEnabled: false, recordingEnabled: false },
    });
});

// Join MCU room
app.post('/api/mcu/rooms/join', (req, res) => {
    res.status(503).json({ error: 'This legacy service has no media engine. Use the configured SFU and optional Poly bridge.' });
});

// Get MCU room info
app.get('/api/mcu/rooms/:roomId', (req, res) => {
    const info = mcuPipeline.getRoomInfo(req.params.roomId);
    if (!info) return res.status(404).json({ error: 'Room not found' });
    res.json(info);
});

// Set layout
app.post('/api/mcu/rooms/:roomId/layout', (req, res) => {
    res.status(503).json({ error: 'Media composition is unavailable in this legacy service.' });
});

// Set active speaker
app.post('/api/mcu/rooms/:roomId/active-speaker', (req, res) => {
    res.status(503).json({ error: 'Active-speaker media routing is unavailable in this legacy service.' });
});

// Start recording
app.post('/api/mcu/rooms/:roomId/recording/start', (_req, res) => {
    res.status(503).json({ error: 'MCU media recording is unavailable' });
});

// Stop recording
app.post('/api/mcu/rooms/:roomId/recording/stop', (req, res) => {
    res.status(503).json({ error: 'MCU media recording is unavailable' });
});

// Start live stream
app.post('/api/mcu/rooms/:roomId/stream', (req, res) => {
    res.status(503).json({ error: 'RTMP streaming is unavailable in this legacy service.' });
});

// Remove participant
app.delete('/api/mcu/rooms/:roomId/participants/:peerId', (req, res) => {
    mcuPipeline.removeParticipant(req.params.roomId, req.params.peerId);
    res.json({ removed: true });
});

// Get all rooms
app.get('/api/mcu/rooms', (_req, res) => {
    res.json({ rooms: mcuPipeline.getAllRooms() });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SIP/H.323 GATEWAY STATUS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/api/gateway/status', (_req, res) => {
    res.status(503).json({
        status: 'unavailable',
        reason: 'A SIP/H.323 media gateway is not integrated with this service.',
        sip: { enabled: false },
        h323: { enabled: false },
        rtmp: { enabled: false },
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// START MCU SERVER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const PORT = DEFAULT_MCU_CONFIG.port;

app.listen(PORT, '127.0.0.1', () => {
    console.log(`🎬 QS-VC MCU Service running on port ${PORT}`);
    console.log(`   Layouts: grid, speaker, presentation, spotlight, filmstrip`);
    console.log('   SIP/H.323 media gateway unavailable');
    console.log(`   Recording: ${DEFAULT_MCU_CONFIG.recordingEnabled ? DEFAULT_MCU_CONFIG.recordingPath : 'disabled'}`);
});

export { mcuPipeline, MCUPipeline, DEFAULT_MCU_CONFIG };
