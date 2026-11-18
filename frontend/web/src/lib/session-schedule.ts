import type { MeetingKind } from '../components/MeetingSetupDialog';

const DAY_MS = 24 * 60 * 60 * 1000;
export const SCHEDULE_WINDOW_MS = 3 * DAY_MS;
export const SCHEDULE_WINDOW_MESSAGE = 'Choose start times within the next 72 hours.';

export interface SessionMeeting {
    id: string;
    title: string;
    start: string;
    duration: number;
    meetingKind: MeetingKind;
    previewPath: string;
}

export function scheduledStarts(start: number, count: number, now = Date.now()): string[] {
    if (!Number.isInteger(count) || count < 1 || count > 3) throw new Error(SCHEDULE_WINDOW_MESSAGE);
    const last = start + (count - 1) * DAY_MS;
    if (!Number.isFinite(start) || start <= now || last > now + SCHEDULE_WINDOW_MS) {
        throw new Error(SCHEDULE_WINDOW_MESSAGE);
    }
    return Array.from({ length: count }, (_, index) => new Date(start + index * DAY_MS).toISOString());
}

export function readSessionMeetings(userId: string): SessionMeeting[] {
    const raw = sessionStorage.getItem(`qsvc:schedule:${userId}`);
    return raw ? JSON.parse(raw) : [];
}

export function writeSessionMeetings(userId: string, meetings: SessionMeeting[]) {
    sessionStorage.setItem(`qsvc:schedule:${userId}`, JSON.stringify(meetings));
}

export function rememberGuestHost(meetingCode: string, token: string) {
    sessionStorage.setItem(`qsvc:guest-host:${meetingCode.toUpperCase()}`, token);
}

export function getGuestHostToken(meetingCode: string): string | undefined {
    try { return sessionStorage.getItem(`qsvc:guest-host:${meetingCode.toUpperCase()}`) || undefined; }
    catch { return undefined; }
}
