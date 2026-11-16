import { describe, expect, it, vi } from 'vitest';
import { roomManager, type PeerState } from './room-manager.js';
import { encryptedQuestionsRpc } from './encrypted-questions.js';

function setup() {
    const room = roomManager.getOrCreateRoom(`questions-${crypto.randomUUID()}`);
    room.settings.e2eeRequired = true;
    room.e2eeKeyHolderPeerId = 'host';
    const sockets = { host: { readyState: 1, send: vi.fn() }, member: { readyState: 1, send: vi.fn() } };
    for (const id of ['host', 'member'] as const) room.peers.set(id, { id, ws: sockets[id], role: id === 'host' ? 'host' : 'member', displayName: id,
        e2eeKeyBundle: { peerId: id, signingPublicKey: id, kemPublicKey: 'kem', signature: 'sig' } } as unknown as PeerState);
    const rpc = (id: keyof typeof sockets, method: string, params: unknown = {}) => encryptedQuestionsRpc(sockets[id], room.id, id, method, params) as any;
    const sealed = (id: string, fileId: string, revision = 1) => ({ version: 1, room: room.id, senderPeerId: id, fileId, revision, noteVersion: 1,
        epoch: Buffer.alloc(32,1).toString('base64'), nonce: Buffer.alloc(12,2).toString('base64'), ciphertext: Buffer.alloc(32,3).toString('base64'), signature: Buffer.alloc(4627,4).toString('base64') });
    return { room, sockets, rpc, sealed };
}
describe('encrypted questions', () => {
    it('stores only sealed records and restricts official answers', () => {
        const { room, rpc, sealed, sockets } = setup();
        const id = crypto.randomUUID();
        expect(() => encryptedQuestionsRpc({}, room.id, 'member', 'getEncryptedQuestions', {})).toThrow('member');
        expect(() => rpc('member', 'putEncryptedQuestion', { kind: 'question', encrypted: { ...sealed('member', id), text: 'secret' } })).toThrow();
        rpc('member', 'putEncryptedQuestion', { kind: 'question', encrypted: sealed('member', id) });
        expect(() => rpc('member', 'putEncryptedQuestion', { kind: 'answer', encrypted: sealed('member', id) })).toThrow('hosts');
        rpc('host', 'putEncryptedQuestion', { kind: 'answer', encrypted: sealed('host', id) });
        const page = rpc('member', 'getEncryptedQuestions');
        expect(page.records).toHaveLength(1);
        expect(page.records[0]).toMatchObject({ kind: 'question', authorId: 'member', authorSigningKey: 'member' });
        expect(page.nextCursor).toBe(1);
        expect(rpc('member', 'getEncryptedQuestions', { cursor: 1, revision: page.revision }).records[0].kind).toBe('answer');
        expect(sockets.host.send.mock.calls.map(call => call[0]).join('')).not.toContain('secret');
    });
    it('deduplicates votes, rejects stale state reads and preserves original authors during reseal', () => {
        const { rpc, sealed } = setup();
        const id = crypto.randomUUID();
        rpc('member', 'putEncryptedQuestion', { kind: 'question', encrypted: sealed('member', id) });
        const first = rpc('host', 'getEncryptedQuestions');
        rpc('member', 'voteEncryptedQuestion', { id });
        const revision = rpc('member', 'voteEncryptedQuestion', { id }).revision;
        expect(revision).toBe(2);
        expect(() => rpc('host', 'getEncryptedQuestions', { cursor: 0, revision: first.revision })).toThrow('changed');
        const rewrapped = { ...sealed('host', id, 2), epoch: Buffer.alloc(32,5).toString('base64') };
        rpc('host', 'putEncryptedQuestion', { kind: 'question', encrypted: rewrapped });
        expect(rpc('host', 'getEncryptedQuestions').records[0]).toMatchObject({ authorId: 'member', authorSigningKey: 'member', voters: ['member'], signingPublicKey: 'host' });
        expect(() => rpc('member', 'putEncryptedQuestion', { kind: 'question', encrypted: sealed('member', id, 3) })).toThrow('replaced');
    });
});
