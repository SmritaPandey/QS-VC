export interface BoardPoint { x: number; y: number }
export interface BoardStroke { id: string; authorId: string; points: BoardPoint[]; color: string; width: number }
export interface MeetingPoll { id: string; question: string; options: string[]; votes: Record<string, number>; closed: boolean }
export interface MeetingQuestion { id: string; text: string; authorId: string; authorName: string; voters: string[]; answer?: string }
export interface MeetingFile { id: string; name: string; mime: string; size: number; authorId: string; authorName: string }
export interface CollaborationState { revision: number; strokes: BoardStroke[]; notes: { text: string; version: number }; polls: MeetingPoll[]; questions: MeetingQuestion[]; files: MeetingFile[] }
export const EMPTY_COLLABORATION: CollaborationState = { revision: -1, strokes: [], notes: { text: '', version: 0 }, polls: [], questions: [], files: [] };
export const MAX_SHARED_FILE_BYTES = 32 * 1024;
export const SHARED_FILE_TYPES = ['image/png', 'image/jpeg', 'text/plain', 'application/pdf'];

export function newerCollaboration(current: CollaborationState, incoming: CollaborationState) {
    return incoming.revision >= current.revision ? incoming : current;
}
export function boardPoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): BoardPoint | null {
    if (rect.width <= 0 || rect.height <= 0 || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    return { x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)) };
}
export function pollCounts(poll: MeetingPoll): number[] {
    const counts = poll.options.map(() => 0);
    for (const choice of Object.values(poll.votes)) if (Number.isInteger(choice) && choice >= 0 && choice < counts.length) counts[choice]++;
    return counts;
}
export function sharedFileError(size: number, mime: string): string {
    if (!Number.isFinite(size) || size <= 0 || size > MAX_SHARED_FILE_BYTES) return 'Choose a file between 1 byte and 32 KB.';
    if (!SHARED_FILE_TYPES.includes(mime)) return 'Choose a PNG, JPEG, PDF or plain text file.';
    return '';
}
