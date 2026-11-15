import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { serviceSecret } from '../../../shared/service-secrets.cjs';

const metric = z.number().finite().min(0).max(60000).nullable();
export const qualitySampleBody = z.object({ rttMs: metric, jitterMs: metric, packetLossPercent: z.number().finite().min(0).max(100).nullable(), audioActive: z.boolean().nullable() });
type Metrics = z.infer<typeof qualitySampleBody>;
export interface ParticipantReport {
    peerId: string; displayName: string; joinedAt: string; leftAt: string | null; durationMs: number;
    estimatedSpeakingMs: number; samples: number; latest: Metrics | null; issues: { poorQualitySamples: number; metricsUnavailableSamples: number };
    lastSampleAt: string | null; qualityWindow: { receivedAt: string; rttMs: number | null; jitterMs: number | null; packetLossPercent: number | null }[]; version: number;
}
type Peer = { id: string; displayName: string; userId?: string; platformAdmin?: boolean; joinedAt?: Date };
type Room = { id: string; meetingCode: string; ownerUserId?: string | null; createdAt: Date };
type ObservedPeer = { report: ParticipantReport; userId?: string; platformAdmin?: boolean; lastSample: number | null; persistedAt: number; attendedMs: number; activeSince: number };
type ObservedRoom = { sessionId: string; meetingCode: string; ownerUserId?: string | null; startedAt: string; peers: Map<string, ObservedPeer>; incomplete: boolean; storageFailed: boolean };
type Snapshot = { sessionId: string; startedAt: string; incomplete: boolean; participant: ParticipantReport };

export async function persistParticipantReport(meetingCode: string, snapshot: Snapshot): Promise<boolean> {
    try {
        const token = jwt.sign({}, serviceSecret('MEETING_POLICY_SECRET'), { audience: 'qsvc-meeting-policy', issuer: 'qsvc-internal', expiresIn: 30 });
        const response = await fetch(`${process.env.MEETING_INTERNAL_URL || 'http://localhost:4003'}/api/internal/meetings/${encodeURIComponent(meetingCode)}/session-report`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(snapshot), signal: AbortSignal.timeout(5000),
        });
        return response.ok;
    } catch { return false; }
}

/** Attendance is server-observed. Network and sound-activity figures are explicitly client-reported. */
export class MeetingObservability {
    private rooms = new Map<string, ObservedRoom>();
    private writes = new Set<Promise<unknown>>();
    constructor(private persist = persistParticipantReport, private now = Date.now) {}
    joined(room: Room, peer: Peer): void {
        let observed = this.rooms.get(room.id);
        if (!observed) {
            if (this.rooms.size >= 200) return;
            observed = { sessionId: randomUUID(), meetingCode: room.meetingCode, ownerUserId: room.ownerUserId, startedAt: room.createdAt.toISOString(), peers: new Map(), incomplete: false, storageFailed: false };
            this.rooms.set(room.id, observed);
        }
        const at = this.now();
        const existing = observed.peers.get(peer.id);
        if (existing) {
            if (!existing.report.leftAt) return;
            existing.activeSince = at;
            existing.lastSample = null;
            existing.persistedAt = at;
            existing.report.leftAt = null;
            existing.report.lastSampleAt = null;
            existing.report.latest = null;
            existing.report.version++;
            this.write(observed, existing);
            return;
        }
        // Explicit completeness flag instead of silently inventing attendance beyond the supported bound.
        if (observed.peers.size >= 5000) { observed.incomplete = true; return; }
        observed.peers.set(peer.id, { userId: peer.userId, platformAdmin: peer.platformAdmin, lastSample: null, persistedAt: at, attendedMs: 0, activeSince: at,
            report: { peerId: peer.id, displayName: peer.displayName.slice(0, 100), joinedAt: new Date(at).toISOString(), leftAt: null, durationMs: 0,
                estimatedSpeakingMs: 0, samples: 0, latest: null, lastSampleAt: null, qualityWindow: [], issues: { poorQualitySamples: 0, metricsUnavailableSamples: 0 }, version: 1 } });
        this.write(observed, observed.peers.get(peer.id)!);
    }
    private write(room: ObservedRoom, peer: ObservedPeer) {
        const snapshot: Snapshot = JSON.parse(JSON.stringify({ sessionId: room.sessionId, startedAt: room.startedAt, incomplete: room.incomplete, participant: peer.report }));
        if (this.writes.size >= 256) { room.storageFailed = true; return; }
        const write = this.persist(room.meetingCode, snapshot).then(saved => { if (!saved) room.storageFailed = true; }).catch(() => { room.storageFailed = true; });
        this.writes.add(write); void write.finally(() => this.writes.delete(write));
    }
    sample(roomId: string, peerId: string, input: unknown) {
        const room = this.rooms.get(roomId), peer = room?.peers.get(peerId);
        if (!room || !peer || peer.report.leftAt) throw new Error('Not joined to this meeting');
        const parsed = qualitySampleBody.safeParse(input);
        if (!parsed.success) throw new Error('Invalid connection sample');
        const at = this.now();
        if (peer.lastSample !== null && at - peer.lastSample < 3000) throw new Error('Connection samples are limited to one every 3 seconds');
        const elapsed = peer.lastSample !== null ? Math.min(5000, Math.max(0, at - peer.lastSample)) : 0;
        if (parsed.data.audioActive) peer.report.estimatedSpeakingMs += elapsed;
        peer.lastSample = at;
        peer.report.lastSampleAt = new Date(at).toISOString(); peer.report.samples++;
        peer.report.latest = parsed.data;
        peer.report.qualityWindow = [...peer.report.qualityWindow.filter(item => at - Date.parse(item.receivedAt) <= 60000).slice(-11), { receivedAt: new Date(at).toISOString(), rttMs: parsed.data.rttMs, jitterMs: parsed.data.jitterMs, packetLossPercent: parsed.data.packetLossPercent }];
        peer.report.durationMs = peer.attendedMs + Math.max(0, at - peer.activeSince);
        if (parsed.data.rttMs === null && parsed.data.jitterMs === null && parsed.data.packetLossPercent === null) peer.report.issues.metricsUnavailableSamples++;
        if ((parsed.data.rttMs ?? 0) > 500 || (parsed.data.jitterMs ?? 0) > 50 || (parsed.data.packetLossPercent ?? 0) > 5) peer.report.issues.poorQualitySamples++;
        peer.report.version++;
        if (at - peer.persistedAt >= 30000) { peer.persistedAt = at; this.write(room, peer); }
        return { accepted: true, receivedAt: peer.report.lastSampleAt };
    }
    left(roomId: string, peerId: string): void {
        const room = this.rooms.get(roomId), peer = room?.peers.get(peerId);
        if (!room || !peer || peer.report.leftAt) return;
        const at = this.now(); peer.report.leftAt = new Date(at).toISOString();
        peer.attendedMs += Math.max(0, at - peer.activeSince);
        peer.report.durationMs = peer.attendedMs; peer.report.version++;
        this.write(room, peer);
    }
    ended(roomId: string): void {
        const room = this.rooms.get(roomId); if (!room) return;
        for (const id of room.peers.keys()) this.left(roomId, id);
        this.rooms.delete(roomId);
    }
    report(roomId: string, peerId: string, authSub?: string) {
        const room = this.rooms.get(roomId), actor = room?.peers.get(peerId);
        if (!room || !actor || !authSub || actor.userId !== authSub || (!actor.platformAdmin && room.ownerUserId !== authSub)) throw new Error('Only the signed-in meeting owner or platform administrator can open this report');
        return { sessionId: room.sessionId, startedAt: room.startedAt, incomplete: room.incomplete, persistence: room.storageFailed ? 'some-records-unsaved' : 'best-effort',
            metricSource: 'Client-reported WebRTC metrics; speaking time estimates sampled microphone sound activity, not voice identity.',
            participants: [...room.peers.values()].map(peer => ({ ...peer.report, durationMs: peer.report.leftAt ? peer.report.durationMs : peer.attendedMs + Math.max(0, this.now() - peer.activeSince) })) };
    }
    async flush(): Promise<void> { await Promise.allSettled([...this.writes]); }
}
export const meetingObservability = new MeetingObservability();
