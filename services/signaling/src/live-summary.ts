import { roomManager } from './room-manager.js';
import { generateMeetingSummary } from './ai-meeting-summary.js';
import { saveTranscript } from './transcript-store.js';
import type { TranscriptEntry } from './captions.js';
import meetingInvitation from '../../../shared/meeting-invitation.cjs';

class LiveSummary {
    active = true;
    started = Date.now();
    entries: TranscriptEntry[] = [];
    revision = 0;
    completed = 0;
    text = '';
    saved = false;
    message = 'Waiting for shared captions.';
    timer?: ReturnType<typeof setTimeout>;
    pending?: Promise<void>;
}

const sessions = new Map<string, LiveSummary>();
const notify = (roomId: string, active: boolean) => roomManager.broadcast(roomId, 'liveSummaryChanged', { active });

export function liveSummaryState(roomId: string, manager: boolean) {
    const session = sessions.get(roomId);
    return { active: !!session?.active, ...(manager && session ? { text: session.text, saved: session.saved, message: session.message } : {}) };
}

export function startLiveSummary(roomId: string) {
    const previous = sessions.get(roomId);
    if (previous?.active) return;
    if (previous?.pending) throw new Error('The previous summary is finishing.');
    sessions.set(roomId, new LiveSummary());
    notify(roomId, true);
}

async function update(roomId: string, code: string, session: LiveSummary) {
    if (session.pending) await session.pending;
    if (session.completed === session.revision || !session.entries.length) return;
    if (session.pending) return session.pending;
    const revision = session.revision;
    session.pending = (async () => {
        try {
            const text = await generateMeetingSummary(session.entries.slice(), {
                meetingCode: code, participants: [], durationMs: Date.now() - session.started,
            });
            session.text = text;
            session.saved = !meetingInvitation.isSessionMeetingCode(code)
                && await saveTranscript(code, [], session.started, undefined, text);
            session.completed = revision;
            session.message = session.saved ? 'Summary saved to your workspace.' : 'Summary ready in this meeting.';
        } catch {
            session.message = 'The latest summary update was unavailable.';
        }
    })().finally(() => { session.pending = undefined; });
    await session.pending;
}

export function addSummaryCaption(roomId: string, code: string, entry: TranscriptEntry) {
    const session = sessions.get(roomId);
    if (!session?.active) return;
    session.entries.push(entry);
    if (session.entries.length > 2000) session.entries.shift();
    session.revision++;
    if (!session.timer) {
        session.timer = setTimeout(() => {
            session.timer = undefined;
            void update(roomId, code, session);
        }, session.text ? 120_000 : 30_000);
        session.timer.unref();
    }
}

export async function stopLiveSummary(roomId: string, code: string) {
    const session = sessions.get(roomId);
    if (!session?.active) return;
    session.active = false;
    clearTimeout(session.timer);
    notify(roomId, false);
    await update(roomId, code, session);
    session.entries = [];
}

export async function finishLiveSummary(roomId: string, code: string) {
    const session = sessions.get(roomId);
    await stopLiveSummary(roomId, code);
    if (sessions.get(roomId) === session) sessions.delete(roomId);
}
