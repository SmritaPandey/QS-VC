import { z } from 'zod';
import { roomManager, type RoomState } from './room-manager.js';

const base64 = (min: number, max: number) => z.string().min(min).max(max).regex(/^[A-Za-z0-9+/]+={0,2}$/).refine(value => value.length % 4 === 0);
const envelopeSchema = z.object({
    version: z.literal(1), room: z.string(), epoch: base64(44, 44), senderPeerId: z.string(),
    revision: z.number().int().min(1), noteVersion: z.literal(1), fileId: z.string().uuid(),
    nonce: base64(16, 16), ciphertext: base64(24, 24000), signature: base64(6000, 8192),
}).strict();
type Envelope = z.infer<typeof envelopeSchema>;
export interface SecureQuestionRecord {
    kind: 'question' | 'answer'; encrypted: Envelope; signingPublicKey: string;
    authorId: string; authorName: string; authorSigningKey: string; voters: string[];
}
interface State { revision: number; records: Map<string, SecureQuestionRecord>; rates: Map<string, { at: number; count: number }> }
const states = new WeakMap<RoomState, State>();
const recordKey = (kind: string, id: string) => `${kind}:${id}`;
function fail(message: string): never { throw new Error(message); }

export function encryptedQuestionsRpc(ws: unknown, roomId: string, peerId: string, method: string, params: unknown) {
    const room = roomManager.getRoom(roomId);
    const peer = room?.peers.get(peerId);
    if (!room || !peer || peer.ws !== ws || !room.settings.e2eeRequired || !peer.e2eeKeyBundle) fail('A registered encrypted room member is required');
    let state = states.get(room);
    if (!state) { state = { revision: 0, records: new Map(), rates: new Map() }; states.set(room, state); }
    for (const id of state.rates.keys()) if (!room.peers.has(id)) state.rates.delete(id);
    const now = Date.now();
    let rate = state.rates.get(peerId);
    if (!rate || now - rate.at >= 1000) { rate = { at: now, count: 0 }; state.rates.set(peerId, rate); }
    if (++rate.count > 20) fail('Please slow down');
    const manager = peer.role === 'host' || peer.role === 'co-host';
    if (method === 'getEncryptedQuestions') {
        const input = z.object({ cursor: z.number().int().min(0).max(200).default(0), revision: z.number().int().min(0).optional() }).strict().parse(params ?? {});
        if (input.revision !== undefined && input.revision !== state.revision) fail('Question state changed. Restart the read.');
        const records = [...state.records.values()];
        return { records: records.slice(input.cursor, input.cursor + 1), revision: state.revision,
            nextCursor: input.cursor + 1 < records.length ? input.cursor + 1 : null };
    }
    if (method === 'voteEncryptedQuestion') {
        const { id } = z.object({ id: z.string().uuid() }).strict().parse(params);
        const record = state.records.get(recordKey('question', id));
        if (!record) fail('Question not found');
        if (record.voters.includes(peerId)) return { revision: state.revision };
        if (record.voters.length >= 250 || [...state.records.values()].reduce((total, item) => total + item.voters.length, 0) >= 1000) fail('Question vote limit reached');
        record.voters.push(peerId);
    } else if (method === 'putEncryptedQuestion') {
        const { kind, encrypted } = z.object({ kind: z.enum(['question', 'answer']), encrypted: envelopeSchema }).strict().parse(params);
        if (encrypted.room !== room.id || encrypted.senderPeerId !== peerId) fail('Invalid question sender or room');
        const key = recordKey(kind, encrypted.fileId);
        const current = state.records.get(key);
        if (encrypted.revision !== (current?.encrypted.revision ?? 0) + 1) fail('Question changed. Refresh before saving.');
        const reseal = current && room.e2eeKeyHolderPeerId === peerId && current.encrypted.epoch !== encrypted.epoch;
        if (!reseal) {
            if (kind === 'answer' && !manager) fail('Only hosts and co-hosts can answer');
            if (kind === 'question' && current) fail('Questions cannot be replaced');
            if (kind === 'answer' && !state.records.has(recordKey('question', encrypted.fileId))) fail('Question not found');
            if (kind === 'question' && [...state.records.values()].filter(record => record.kind === 'question').length >= 100) fail('Question limit reached');
        }
        state.records.set(key, { kind, encrypted, signingPublicKey: peer.e2eeKeyBundle.signingPublicKey,
            authorId: reseal ? current.authorId : peerId, authorName: reseal ? current.authorName : peer.displayName,
            authorSigningKey: reseal ? current.authorSigningKey : peer.e2eeKeyBundle.signingPublicKey,
            voters: current?.voters ?? [] });
    } else fail('Unknown encrypted question action');
    state.revision++;
    roomManager.broadcast(room.id, 'encryptedQuestionsChanged', { revision: state.revision }, peerId);
    return { revision: state.revision };
}
