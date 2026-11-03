import jwt from 'jsonwebtoken';
import { z } from 'zod';
const policySchema = z.object({ hostId: z.string().nullable(), status: z.string(), settings: z.object({
    maxParticipants: z.number().int().min(1).max(1000).optional(), waitingRoomEnabled: z.boolean().optional(), locked: z.boolean().optional(), password: z.string().nullable().optional(), muteOnEntry: z.boolean().optional(), allowScreenShare: z.boolean().optional(), allowChat: z.boolean().optional(), allowRecording: z.boolean().optional(),
    waitingRoom: z.boolean().optional(), chatEnabled: z.boolean().optional(), screenShareEnabled: z.boolean().optional(), e2eeRequired: z.boolean().optional(),
}) });
export async function loadMeetingPolicy(code: string) {
    const base = process.env.MEETING_INTERNAL_URL || 'http://localhost:4003';
    const token = jwt.sign({}, process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production', { audience: 'qsvc-meeting-policy', issuer: 'qsvc-internal', expiresIn: 30 });
    const response = await fetch(`${base}/api/internal/meetings/${encodeURIComponent(code)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(4000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Meeting access could not be verified. Please retry.');
    const policy = policySchema.parse(await response.json());
    if (['ended', 'cancelled'].includes(policy.status)) throw new Error('This meeting has ended or was cancelled.');
    if (policy.settings.e2eeRequired) throw new Error('This meeting requires end-to-end encryption that this client cannot yet verify.');
    const { waitingRoom, chatEnabled, screenShareEnabled, e2eeRequired, ...settings } = policy.settings;
    return { ...policy, settings: {
        ...settings,
        waitingRoomEnabled: settings.waitingRoomEnabled ?? waitingRoom ?? false,
        allowChat: settings.allowChat ?? chatEnabled ?? true,
        allowScreenShare: settings.allowScreenShare ?? screenShareEnabled ?? true,
        allowRecording: false,
    } };
}
