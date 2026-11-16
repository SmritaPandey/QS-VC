import type { BoardPoint, BoardStickyNote, BoardStroke } from './collaboration-state';
import { STICKY_COLORS } from './collaboration-state';
import type { EncryptedNotesAccess } from './encrypted-notes';
import type { EncryptedNotesRecord } from './e2ee-data';
import { signaling } from './signaling';

const DOMAIN = 'QS-VC-BOARD:v1';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type BoardKind = 'stroke' | 'sticky';
export interface EncryptedBoardRecord extends EncryptedNotesRecord {
    kind: BoardKind;
    authorId: string;
    authorName: string;
    editorId: string;
    editorSigningKey: string;
}
interface BoardPayload {
    domain: typeof DOMAIN;
    kind: BoardKind;
    authorId: string;
    version: number;
    text?: string;
    color: string;
    points?: BoardPoint[];
    width?: number;
}
export interface EncryptedBoardState {
    revision: number;
    strokes: BoardStroke[];
    stickyNotes: BoardStickyNote[];
    records: Map<string, EncryptedBoardRecord>;
}
interface BoardPage { records: EncryptedBoardRecord[]; nextCursor: number | null; revision: number }

function payloadOf(text: string, record: EncryptedBoardRecord): BoardPayload {
    const value = JSON.parse(text);
    if (!value || value.domain !== DOMAIN || value.kind !== record.kind || value.authorId !== record.authorId ||
        !Number.isSafeInteger(value.version) || value.version < 0 || typeof value.color !== 'string') {
        throw new Error('Invalid encrypted whiteboard content.');
    }
    if (value.kind === 'sticky') {
        if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 240 ||
            !STICKY_COLORS.includes(value.color)) throw new Error('Invalid encrypted sticky note.');
    } else if (value.kind === 'stroke') {
        if (value.version !== 0 || !/^#[0-9a-f]{6}$/i.test(value.color) || !Number.isFinite(value.width) ||
            value.width < 1 || value.width > 12 || !Array.isArray(value.points) || value.points.length < 2 || value.points.length > 1000 ||
            value.points.some((point: BoardPoint) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
                point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) throw new Error('Invalid encrypted whiteboard stroke.');
    } else throw new Error('Invalid encrypted whiteboard tool.');
    return value;
}

async function openRecord(access: EncryptedNotesAccess, record: EncryptedBoardRecord) {
    const id = record.encrypted.fileId;
    if (!id || !uuid.test(id) || typeof record.authorId !== 'string' || typeof record.authorName !== 'string' ||
        typeof record.editorId !== 'string' || typeof record.editorSigningKey !== 'string') throw new Error('Invalid encrypted whiteboard record.');
    const outerKey = access.signingKeyFor(record.encrypted.senderPeerId);
    const editorKey = access.signingKeyFor(record.editorId);
    if ((outerKey && outerKey !== record.signingPublicKey) || (editorKey && editorKey !== record.editorSigningKey)) {
        throw new Error('The whiteboard verification identity changed.');
    }
    const opened = await access.manager.openNotes(record);
    const signed = JSON.parse(opened.text);
    if (!signed || typeof signed.payload !== 'string' || typeof signed.signature !== 'string' ||
        !await access.manager.verifyFile(id, signed.payload, signed.signature, record.editorSigningKey)) {
        throw new Error('The whiteboard author signature could not be verified.');
    }
    return { id, payload: payloadOf(signed.payload, record), ...opened };
}

async function loadPages(): Promise<{ revision: number; records: EncryptedBoardRecord[] }> {
    for (let attempt = 0; attempt < 3; attempt++) {
        const records: EncryptedBoardRecord[] = [];
        let revision: number | undefined;
        let cursor: number | null = 0;
        let changed = false;
        while (cursor !== null) {
            let page: BoardPage;
            try {
                page = await signaling.request('getEncryptedBoard', { cursor, ...(revision === undefined ? {} : { revision }) });
            } catch (error) {
                if (revision !== undefined && error instanceof Error && error.message.includes('Whiteboard changed')) { changed = true; break; }
                throw error;
            }
            if (!page || !Number.isSafeInteger(page.revision) || page.revision < 0 || !Array.isArray(page.records) || page.records.length > 1) {
                throw new Error('Invalid encrypted whiteboard snapshot.');
            }
            if (revision !== undefined && page.revision !== revision) { changed = true; break; }
            revision = page.revision;
            records.push(...page.records);
            if (records.length > 560 || (page.nextCursor !== null && (!Number.isSafeInteger(page.nextCursor) || page.nextCursor <= cursor))) {
                throw new Error('Invalid encrypted whiteboard page.');
            }
            cursor = page.nextCursor;
            if (cursor !== null) await new Promise(resolve => setTimeout(resolve, 25));
        }
        if (!changed) return { revision: revision ?? 0, records };
    }
    throw new Error('The whiteboard changed while loading. Refresh to see the latest board.');
}

export async function readEncryptedBoard(access: EncryptedNotesAccess): Promise<EncryptedBoardState> {
    const snapshot = await loadPages();
    const state: EncryptedBoardState = { revision: snapshot.revision, strokes: [], stickyNotes: [], records: new Map() };
    let totalPoints = 0;
    for (const record of snapshot.records) {
        const opened = await openRecord(access, record);
        if (state.records.has(opened.id)) throw new Error('Duplicate encrypted whiteboard item.');
        let current = record;
        if (!opened.currentEpoch && access.isKeyHolder()) {
            await new Promise(resolve => setTimeout(resolve, 60));
            const encrypted = await access.manager.sealNotes(opened.text, record.encrypted.revision + 1, 1, opened.id);
            const result = await signaling.request('putEncryptedBoard', { kind: record.kind, encrypted, rewrap: true });
            state.revision = result.revision;
            current = { ...record, encrypted, signingPublicKey: access.signingKeyFor(encrypted.senderPeerId) || record.signingPublicKey };
        }
        state.records.set(opened.id, current);
        const payload = opened.payload;
        if (payload.kind === 'sticky') {
            state.stickyNotes.push({ id: opened.id, authorId: record.authorId, authorName: record.authorName,
                text: payload.text!, color: payload.color as BoardStickyNote['color'], version: payload.version });
        } else {
            totalPoints += payload.points!.length;
            state.strokes.push({ id: opened.id, authorId: record.authorId, points: payload.points!, color: payload.color, width: payload.width! });
        }
    }
    if (state.strokes.length > 500 || state.stickyNotes.length > 60 || totalPoints > 20000) throw new Error('Encrypted whiteboard limit exceeded.');
    return state;
}

export async function actEncryptedBoard(access: EncryptedNotesAccess, action: Record<string, unknown>, current: EncryptedBoardState, myPeerId: string): Promise<EncryptedBoardState> {
    if (action.type === 'board:clear') {
        await signaling.request('clearEncryptedBoard', {});
        return readEncryptedBoard(access);
    }
    const remove = action.type === 'stroke:undo' || action.type === 'sticky:remove';
    const update = action.type === 'sticky:update';
    const kind: BoardKind = action.type === 'stroke:add' || action.type === 'stroke:undo' ? 'stroke' : 'sticky';
    if (!['stroke:add', 'stroke:undo', 'sticky:add', 'sticky:update', 'sticky:remove'].includes(String(action.type))) {
        throw new Error('Unsupported encrypted whiteboard action.');
    }
    const id = remove || update ? String(action.id) : crypto.randomUUID();
    const previous = current.records.get(id);
    if ((remove || update) && (!previous || previous.kind !== kind)) throw new Error('Whiteboard item no longer exists. Refresh the board.');
    if ((update || action.type === 'sticky:remove') && current.stickyNotes.find(note => note.id === id)?.version !== action.version) {
        throw new Error('Sticky note changed. Your draft is still available.');
    }
    if (remove) {
        await signaling.request('removeEncryptedBoard', { id, revision: previous!.encrypted.revision });
    } else {
        const payload: BoardPayload = {
            domain: DOMAIN, kind, authorId: previous?.authorId ?? myPeerId,
            version: update ? Number(action.version) + 1 : 0, color: String(action.color),
            ...(kind === 'sticky' ? { text: String(action.text ?? '').trim() } : { points: action.points as BoardPoint[], width: Number(action.width) }),
        };
        const serialized = JSON.stringify(payload);
        payloadOf(serialized, { kind, authorId: payload.authorId } as EncryptedBoardRecord);
        const signature = await access.manager.signFile(id, serialized);
        const encrypted = await access.manager.sealNotes(JSON.stringify({ payload: serialized, signature }), (previous?.encrypted.revision ?? 0) + 1, 1, id);
        await signaling.request('putEncryptedBoard', { kind, encrypted });
    }
    return readEncryptedBoard(access);
}
