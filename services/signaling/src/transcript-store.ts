import jwt from 'jsonwebtoken';
import { logger } from './logger.js';

export type SavedSegment = { id: string; peerId: string; speaker: string; language: string; text: string; timestamp: number };

function serviceToken() {
    return jwt.sign({}, process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production', { audience: 'qsvc-meeting-policy', issuer: 'qsvc-internal', expiresIn: 30 });
}

/**
 * Send a host-enabled transcript to the meeting service for storage (best effort, chunked).
 * Nothing is sent unless the host turned on "Save transcript" for the meeting.
 */
export async function saveTranscript(meetingCode: string, entries: SavedSegment[], startedAt: number, minutes?: string): Promise<boolean> {
    if (!entries.length && !minutes) return true;
    const base = process.env.MEETING_INTERNAL_URL || 'http://localhost:4003';
    try {
        // Keep each JSON request below the meeting service's 2 MiB parser limit, even
        // when captions contain multi-byte or JSON-escaped characters.
        const chunkSize = 100;
        for (let start = 0; start < Math.max(entries.length, 1); start += chunkSize) {
            const response = await fetch(`${base}/api/internal/meetings/${encodeURIComponent(meetingCode)}/transcript`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${serviceToken()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ startedAt: new Date(startedAt).toISOString(), segments: entries.slice(start, start + chunkSize).map(({ peerId: _peer, ...rest }) => rest), ...(minutes && start === 0 ? { minutes } : {}) }),
                signal: AbortSignal.timeout(8000),
            });
            if (!response.ok) throw new Error(`status ${response.status}`);
        }
        return true;
    } catch (err) {
        logger.warn({ meetingCode, err: err instanceof Error ? err.message : String(err) }, 'Transcript not stored');
        return false;
    }
}
