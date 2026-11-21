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
    message = 'Waiting for shared speech. Nothing to summarize yet.';
    timer?: ReturnType<typeof setTimeout>;
    speaking = false;
    silence?: ReturnType<typeof setTimeout>;
    lastAttempt = -Infinity;
    pending?: Promise<void>;
}

const sessions = new Map<string, LiveSummary>();
const notify = (roomId: string, active: boolean) => roomManager.broadcast(roomId, 'liveSummaryChanged', { active });

export function liveSummaryState(roomId: string, manager: boolean) {
    const session = sessions.get(roomId);
    return { active: !!session?.active, ...(session?.speaking ? { hasSpeech: true } : {}), ...(session?.text ? { text: session.text } : {}), ...(manager && session ? { saved: session.saved, message: session.message } : {}) };
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
    session.lastAttempt = Date.now();
    const revision = session.revision;
    session.pending = (async () => {
        try {
            const batch = session.entries.slice();
            const text = await generateMeetingSummary(batch, {
                meetingCode: code, participants: [], durationMs: Date.now() - session.started,
                meetingKind: roomManager.getRoom(roomId)?.settings.meetingKind, previousSummary: session.text,
            });
            session.text = text;
            session.saved = !meetingInvitation.isSessionMeetingCode(code)
                && await saveTranscript(code, [], session.started, undefined, text);
            const consumed = session.entries.findIndex(entry => entry === batch[batch.length - 1]);
            if (consumed >= 0) session.entries.splice(0, consumed + 1);
            session.completed = revision;
            session.message = session.saved ? 'Summary saved to your workspace.' : 'Summary ready in this meeting.';
        } catch {
            session.message = 'The latest summary update was unavailable.';
        }
    })().finally(() => { session.pending = undefined; });
    await session.pending;
}

export function refreshLiveSummary(roomId: string, code: string) {
    const session = sessions.get(roomId);
    if (session?.active && session.entries.length && !session.pending && Date.now() - session.lastAttempt >= 5000) {
        session.message = 'Updating recap…';
        void update(roomId, code, session);
    }
}

export function addSummaryCaption(roomId: string, code: string, entry: TranscriptEntry) {
    const session = sessions.get(roomId);
    if (!session?.active) return;
    session.entries.push(entry);
    if (session.entries.length > 2000) session.entries.shift();
    session.revision++;
    if (!session.speaking) {
        session.speaking = true;
        session.message = 'Receiving shared speech for the recap.';
        roomManager.broadcast(roomId, 'liveSummaryChanged', { active: true, hasSpeech: true });
    }
    clearTimeout(session.silence);
    session.silence = setTimeout(() => {
        session.speaking = false;
        notify(roomId, true);
    }, 8000);
    session.silence.unref();
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
    session.speaking = false;
    clearTimeout(session.silence);
    clearTimeout(session.timer);
    if (!session.revision) session.message = 'No shared speech was captured. Nothing to summarize.';
    notify(roomId, false);
    await update(roomId, code, session);
    session.entries = [];
}

export async function finishLiveSummary(roomId: string, code: string) {
    const session = sessions.get(roomId);
    await stopLiveSummary(roomId, code);
    if (sessions.get(roomId) === session) sessions.delete(roomId);
}
