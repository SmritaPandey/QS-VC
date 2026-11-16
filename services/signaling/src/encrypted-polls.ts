import { z } from 'zod';
import { roomManager, type RoomState } from './room-manager.js';
const b64 = (min: number, max: number) => z.string().min(min).max(max).regex(/^[A-Za-z0-9+/]+={0,2}$/).refine(value => value.length % 4 === 0);
const sealed = z.object({ version: z.literal(1), room: z.string(), epoch: b64(44, 44), senderPeerId: z.string(), revision: z.number().int().min(1), noteVersion: z.literal(1), fileId: z.string().uuid(), nonce: b64(16, 16), ciphertext: b64(24, 16384), signature: b64(6000, 8192) }).strict();
const ballot = z.object({ pollId: z.string().uuid(), revision: z.number().int().min(1), senderPeerId: z.string(), targetPeerId: z.string(), capsule: b64(2000, 2200), nonce: b64(16, 16), ciphertext: b64(24, 256), signature: b64(6000, 8192) }).strict();
type Sealed = z.infer<typeof sealed>;
type Ballot = z.infer<typeof ballot>;
interface Record {
    encrypted: Sealed;
    signingPublicKey: string;
    authorId: string;
    authorSigningKey: string;
}
interface Poll {
    definition: Record;
    results: 'live' | 'afterClose' | 'hosts';
    closed: boolean;
    ballotRevision: number;
    ballots: Map<string, Map<string, {
        encrypted: Ballot;
        signingPublicKey: string;
    }>>;
    published?: Record;
}
interface State {
    polls: Map<string, Poll>;
    rates: Map<string, {
        at: number;
        count: number;
    }>;
}
const states = new WeakMap<RoomState, State>();
const manager = (role: string) => role === 'host' || role === 'co-host';
export function encryptedPollRpc(ws: unknown, roomId: string, peerId: string, method: string, params: unknown) {
    const room = roomManager.getRoom(roomId);
    const peer = room?.peers.get(peerId);
    if (!room || !peer || peer.ws !== ws || !room.settings.e2eeRequired || !peer.e2eeKeyBundle)
        throw new Error('Secure room membership required');
    let state = states.get(room);
    if (!state) {
        state = { polls: new Map(), rates: new Map() };
        states.set(room, state);
    }
    for (const id of state.rates.keys())
        if (!room.peers.has(id.replace(/:(?:read|write)$/, '')))
            state.rates.delete(id);
    const now = Date.now();
    const read = method.startsWith('get');
    const rateKey = peerId + (read ? ':read' : ':write');
    const rate = state.rates.get(rateKey);
    if (rate && now - rate.at < 1000) {
        if (++rate.count > (read ? 120 : 20))
            throw new Error('Please slow down');
    }
    else
        state.rates.set(rateKey, { at: now, count: 1 });
    if (method === 'getEncryptedPollIndex')
        return { polls: [...state.polls].map(([id, poll]) => ({ id, closed: poll.closed, results: poll.results, total: poll.ballots.size })) };
    const input = z.object({ id: z.string().uuid() }).passthrough().parse(params);
    const poll = state.polls.get(input.id);
    if (method === 'getEncryptedPollResults') {
        if (!poll)
            throw new Error('Poll not found');
        return poll.published ?? null;
    }
    if (method === 'getEncryptedPoll') {
        if (!poll)
            throw new Error('Poll not found');
        return { definition: poll.definition, closed: poll.closed, results: poll.results, total: poll.ballots.size, ballotRevision: poll.ballotRevision, myRevision: poll.ballots.get(peerId)?.values().next().value?.encrypted.revision ?? 0 };
    }
    if (method === 'getEncryptedBallots') {
        if (!poll || !manager(peer.role))
            throw new Error('Moderator permission required');
        const { cursor, revision } = z.object({ id: z.string().uuid(), cursor: z.number().int().min(0).max(1000).default(0), revision: z.number().int().nonnegative().optional() }).strict().parse(params);
        if ((cursor > 0 && revision === undefined) || (revision !== undefined && revision !== poll.ballotRevision))
            throw new Error('Ballots changed. Restart the read.');
        const list = [...poll.ballots.values()].flatMap(copies => copies.get(peerId) ? [copies.get(peerId)!] : []);
        return { revision: poll.ballotRevision, records: list.slice(cursor, cursor + 1), nextCursor: cursor + 1 < list.length ? cursor + 1 : null, total: poll.ballots.size, myRevision: poll.ballots.get(peerId)?.values().next().value?.encrypted.revision ?? 0 };
    }
    if (method === 'voteEncryptedPoll') {
        if (!poll || poll.closed)
            throw new Error('Poll is closed');
        const { copies } = z.object({ id: z.string().uuid(), copies: z.array(ballot).min(1).max(6) }).strict().parse(params);
        const previous = poll.ballots.get(peerId);
        const expected = (previous?.values().next().value?.encrypted.revision ?? 0) + 1;
        const targets = new Map();
        for (const copy of copies) {
            const target = room.peers.get(copy.targetPeerId);
            if (copy.pollId !== input.id || copy.senderPeerId !== peerId || copy.revision !== expected ||
                !target?.e2eeKeyBundle || !manager(target.role) || targets.has(copy.targetPeerId))
                throw new Error('Invalid ballot recipient or revision');
            targets.set(copy.targetPeerId, { encrypted: copy, signingPublicKey: peer.e2eeKeyBundle.signingPublicKey });
        }
        const moderators = [...room.peers.values()].filter(value => manager(value.role) && value.e2eeKeyBundle);
        if (moderators.some(value => !targets.has(value.id)))
            throw new Error('Moderator list changed. Refresh before voting.');
        if (!previous && [...state.polls.values()].reduce((sum, value) => sum + value.ballots.size, 0) >= 1000)
            throw new Error('Room vote limit reached');
        poll.ballots.set(peerId, targets);
        poll.ballotRevision++;
        poll.published = undefined;
    }
    else if (method === 'rewrapEncryptedPoll') {
        if (!poll || room.e2eeKeyHolderPeerId !== peerId)
            throw new Error('Key holder required');
        const value = z.object({ id: z.string().uuid(), field: z.enum(['definition', 'published']), encrypted: sealed }).strict().parse(params);
        const old = poll[value.field];
        if (!old || value.encrypted.room !== room.id || value.encrypted.senderPeerId !== peerId || value.encrypted.fileId !== input.id ||
            value.encrypted.epoch === old.encrypted.epoch || value.encrypted.revision !== old.encrypted.revision + 1)
            throw new Error('Invalid poll rewrap');
        poll[value.field] = { ...old, encrypted: value.encrypted, signingPublicKey: peer.e2eeKeyBundle.signingPublicKey };
    }
    else {
        if (!manager(peer.role))
            throw new Error('Moderator permission required');
        if (method === 'closeEncryptedPoll') {
            if (!poll)
                throw new Error('Poll not found');
            poll.closed = true;
        }
        else {
            const value = z.object({ id: z.string().uuid(), encrypted: sealed, ballotRevision: z.number().int().nonnegative().optional(), results: z.enum(['live', 'afterClose', 'hosts']).optional() }).strict().parse(params);
            if (value.encrypted.room !== room.id || value.encrypted.senderPeerId !== peerId || value.encrypted.fileId !== value.id)
                throw new Error('Invalid poll sender or room');
            const record = { encrypted: value.encrypted, signingPublicKey: peer.e2eeKeyBundle.signingPublicKey, authorId: peerId, authorSigningKey: peer.e2eeKeyBundle.signingPublicKey };
            if (method === 'createEncryptedPoll') {
                if (poll || value.encrypted.revision !== 1 || !value.results || state.polls.size >= 20)
                    throw new Error('Poll limit or revision invalid');
                state.polls.set(value.id, { definition: record, results: value.results, closed: false, ballotRevision: 0, ballots: new Map() });
            }
            else if (method === 'publishEncryptedPoll') {
                if (!poll || poll.results === 'hosts' || (poll.results === 'afterClose' && !poll.closed))
                    throw new Error('Results are restricted');
                if (value.ballotRevision !== poll.ballotRevision)
                    throw new Error('Ballots changed. Refresh results before publishing.');
                if (value.encrypted.revision !== (poll.published?.encrypted.revision ?? 0) + 1)
                    throw new Error('Results changed');
                poll.published = record;
            }
            else
                throw new Error('Unknown secure poll operation');
        }
    }
    roomManager.broadcast(roomId, 'encryptedPollsChanged', {}, peerId);
    return true;
}
