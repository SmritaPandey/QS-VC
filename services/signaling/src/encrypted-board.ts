import { z } from 'zod';
import { roomManager, type PeerState, type RoomState } from './room-manager.js';

const base64 = (min: number, max: number) => z.string().min(min).max(max)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/).refine(value => value.length % 4 === 0);
const envelopeSchema = z.object({
    version: z.literal(1), room: z.string(), senderPeerId: z.string(),
    epoch: base64(44, 44), fileId: z.string().uuid(),
    revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), noteVersion: z.literal(1),
    nonce: base64(16, 16), ciphertext: base64(24, 43712), signature: base64(6000, 8192),
}).strict();
const putSchema = z.object({ kind: z.enum(['stroke', 'sticky']), encrypted: envelopeSchema, rewrap: z.boolean().default(false) }).strict();
const readSchema = z.object({
    cursor: z.number().int().min(0).max(560).default(0),
    revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
}).strict();
const removeSchema = z.object({ id: z.string().uuid(), revision: z.number().int().min(1) }).strict();

export interface EncryptedBoardRecord {
    kind: 'stroke' | 'sticky';
    encrypted: z.infer<typeof envelopeSchema>;
    signingPublicKey: string;
    authorId: string;
    authorName: string;
    authorSigningKey: string;
    editorId: string;
    editorSigningKey: string;
}
interface BoardState {
    revision: number;
    records: Map<string, EncryptedBoardRecord>;
    retired: Set<string>;
    rates: Map<string, { at: number; reads: number; writes: number }>;
}
const boards = new WeakMap<RoomState, BoardState>();
const MAX_CIPHERTEXT = 512 * 1024;
const MAX_LIFETIME_ENTRIES = 4096;

function requireEditor(room: RoomState, peer: PeerState) {
    if (peer.role !== 'host' && !room.settings.allowScreenShare) {
        throw new Error('The host must grant screen sharing permission before you can edit the whiteboard.');
    }
}
function requireOwner(peer: PeerState, record: EncryptedBoardRecord) {
    if (peer.role !== 'host' && peer.id !== record.authorId) throw new Error('Only the author or host can change this board item.');
}

/** Room-lifetime opaque board storage. A page contains one bounded sealed item. */
export function encryptedBoardRpc(ws: unknown, roomId: string, peerId: string, method: string, params: unknown) {
    const room = roomManager.getRoom(roomId);
    const peer = room?.peers.get(peerId);
    if (!room || !peer || peer.ws !== ws) throw new Error('Not joined a room');
    if (!room.settings.e2eeRequired || !peer.e2eeKeyBundle) throw new Error('Encrypted whiteboard requires a registered secure room member.');
    let state = boards.get(room);
    if (!state) {
        state = { revision: 0, records: new Map(), retired: new Set(), rates: new Map() };
        boards.set(room, state);
    }
    for (const id of state.rates.keys()) if (!room.peers.has(id)) state.rates.delete(id);
    const now = Date.now();
    let rate = state.rates.get(peerId);
    if (!rate || now - rate.at >= 1000) {
        rate = { at: now, reads: 0, writes: 0 };
        state.rates.set(peerId, rate);
    }
    if (method === 'getEncryptedBoard') {
        if (++rate.reads > 120) throw new Error('Please slow down whiteboard reads.');
        const page = readSchema.parse(params ?? {});
        if (page.cursor && page.revision === undefined) throw new Error('Whiteboard revision is required after the first page.');
        if (page.revision !== undefined && page.revision !== state.revision) throw new Error('Whiteboard changed. Restart from the first page.');
        if (page.cursor > state.records.size) throw new Error('Invalid whiteboard cursor.');
        const records = [...state.records.values()].slice(page.cursor, page.cursor + 1);
        return { records, revision: state.revision, nextCursor: page.cursor + 1 < state.records.size ? page.cursor + 1 : null };
    }
    if (++rate.writes > 20) throw new Error('Please slow down whiteboard edits.');
    if (method === 'putEncryptedBoard') {
        const { kind, encrypted, rewrap } = putSchema.parse(params);
        if (encrypted.room !== room.id || encrypted.senderPeerId !== peer.id) throw new Error('Invalid whiteboard sender or room.');
        const current = state.records.get(encrypted.fileId);
        if (rewrap && (!current || room.e2eeKeyHolderPeerId !== peer.id || current.encrypted.epoch === encrypted.epoch)) throw new Error('Invalid whiteboard rewrap.');
        if (!rewrap) {
            requireEditor(room, peer);
            if (current) requireOwner(peer, current);
        }
        if (current && current.kind !== kind) throw new Error('A whiteboard item cannot change kind.');
        if (encrypted.revision !== (current?.encrypted.revision ?? 0) + 1) throw new Error('Whiteboard item changed. Refresh before saving.');
        if (!current) {
            if (state.retired.has(encrypted.fileId)) throw new Error('This whiteboard item was removed.');
            if (state.records.size + state.retired.size >= MAX_LIFETIME_ENTRIES) throw new Error('Whiteboard session limit reached.');
            const count = [...state.records.values()].filter(record => record.kind === kind).length;
            if (count >= (kind === 'stroke' ? 500 : 60)) throw new Error('Whiteboard item limit reached.');
        }
        const total = [...state.records.values()].reduce((sum, record) => sum + record.encrypted.ciphertext.length, 0)
            - (current?.encrypted.ciphertext.length ?? 0) + encrypted.ciphertext.length;
        if (total > MAX_CIPHERTEXT) throw new Error('Whiteboard storage limit reached.');
        const record: EncryptedBoardRecord = {
            kind, encrypted, signingPublicKey: peer.e2eeKeyBundle.signingPublicKey,
            authorId: current?.authorId ?? peer.id, authorName: current?.authorName ?? peer.displayName,
            authorSigningKey: current?.authorSigningKey ?? peer.e2eeKeyBundle.signingPublicKey,
            editorId: rewrap ? current!.editorId : peer.id,
            editorSigningKey: rewrap ? current!.editorSigningKey : peer.e2eeKeyBundle.signingPublicKey,
        };
        if (Buffer.byteLength(JSON.stringify(record), 'utf8') > 60 * 1024) throw new Error('Whiteboard item exceeds the message limit. Use a shorter stroke or note.');
        state.records.set(encrypted.fileId, record);
    } else if (method === 'removeEncryptedBoard') {
        const { id, revision } = removeSchema.parse(params);
        const record = state.records.get(id);
        if (!record) throw new Error('Whiteboard item not found.');
        requireEditor(room, peer);
        requireOwner(peer, record);
        if (revision !== record.encrypted.revision) throw new Error('Whiteboard item changed. Refresh before removing.');
        state.records.delete(id);
        state.retired.add(id);
    } else if (method === 'clearEncryptedBoard') {
        z.object({}).strict().parse(params ?? {});
        if (peer.role !== 'host') throw new Error('Only the host can clear the whiteboard.');
        for (const id of state.records.keys()) state.retired.add(id);
        state.records.clear();
    } else {
        throw new Error('Unknown encrypted whiteboard action.');
    }
    state.revision++;
    roomManager.broadcast(room.id, 'encryptedBoardChanged', { revision: state.revision }, peer.id);
    return { revision: state.revision };
}
