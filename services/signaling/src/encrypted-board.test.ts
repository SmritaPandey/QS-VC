import { describe, expect, it, vi } from 'vitest';
import { encryptedBoardRpc } from './encrypted-board.js';
import { roomManager, type PeerState } from './room-manager.js';

function setup() {
    const room = roomManager.getOrCreateRoom(`secure-board-${crypto.randomUUID()}`);
    room.settings.e2eeRequired = true;
    const sockets = { host: { readyState: 1, send: vi.fn() }, a: { readyState: 1, send: vi.fn() }, b: { readyState: 1, send: vi.fn() } };
    for (const id of ['host', 'a', 'b'] as const) room.peers.set(id, {
        id, ws: sockets[id], role: id === 'host' ? 'host' : 'member', displayName: id,
        e2eeKeyBundle: { peerId: id, signingPublicKey: id + '-key', kemPublicKey: 'kem', signature: 'sig' },
    } as unknown as PeerState);
    const rpc = (id: keyof typeof sockets, method: string, params: unknown = {}) => encryptedBoardRpc(sockets[id], room.id, id, method, params);
    const item = (id: keyof typeof sockets = 'host') => ({ kind: 'sticky' as const, encrypted: {
        version: 1 as const, room: room.id, senderPeerId: id, epoch: Buffer.alloc(32, 1).toString('base64'), fileId: crypto.randomUUID(), revision: 1, noteVersion: 1 as const,
        nonce: Buffer.alloc(12, 2).toString('base64'), ciphertext: Buffer.alloc(32, 3).toString('base64'), signature: Buffer.alloc(4627, 4).toString('base64'),
    } });
    return { room, sockets, rpc, item };
}

describe('opaque encrypted board storage', () => {
    it('requires secure membership and the host grant, retains sealed data, and notifies other attendees', () => {
        const { room, sockets, rpc, item } = setup();
        expect(() => encryptedBoardRpc({}, room.id, 'host', 'getEncryptedBoard', {})).toThrow('Not joined');
        expect(() => rpc('a', 'putEncryptedBoard', item('a'))).toThrow('grant');
        const note = item();
        expect(() => rpc('host', 'putEncryptedBoard', { ...note, text: 'secret' })).toThrow();
        expect(() => rpc('host', 'putEncryptedBoard', { ...note, encrypted: { ...note.encrypted, room: 'other' } })).toThrow('room');
        rpc('host', 'putEncryptedBoard', note);
        expect(rpc('a', 'getEncryptedBoard')).toMatchObject({ revision: 1, records: [{ ...note, authorId: 'host', authorSigningKey: 'host-key' }] });
        expect(sockets.a.send).toHaveBeenCalledOnce();
        expect(sockets.host.send).not.toHaveBeenCalled();
        room.settings.allowScreenShare = true;
        rpc('a', 'putEncryptedBoard', item('a'));
        expect(rpc('host', 'getEncryptedBoard').nextCursor).toBe(1);
        room.peers.delete('b');
        expect(() => rpc('b', 'getEncryptedBoard')).toThrow('Not joined');
    });
    it('rejects stale edits and removal, cross-author writes, and replay after deletion', () => {
        const { room, rpc, item } = setup();
        room.settings.allowScreenShare = true;
        const note = item('a');
        rpc('a', 'putEncryptedBoard', note);
        expect(() => rpc('b', 'putEncryptedBoard', { ...note, encrypted: { ...note.encrypted, senderPeerId: 'b', revision: 2 } })).toThrow('author');
        expect(() => rpc('a', 'putEncryptedBoard', note)).toThrow('changed');
        expect(() => rpc('host', 'removeEncryptedBoard', { id: note.encrypted.fileId, revision: 2 })).toThrow('changed');
        rpc('a', 'removeEncryptedBoard', { id: note.encrypted.fileId, revision: 1 });
        expect(() => rpc('a', 'putEncryptedBoard', note)).toThrow('removed');
    });
    it('requires a stable revision during pagination and lets a key holder reseal after permission revocation', () => {
        const { room, rpc, item } = setup();
        const first = item();
        rpc('host', 'putEncryptedBoard', first);
        rpc('host', 'putEncryptedBoard', item());
        const page = rpc('a', 'getEncryptedBoard');
        expect(() => rpc('a', 'getEncryptedBoard', { cursor: 1 })).toThrow('revision');
        expect(rpc('a', 'getEncryptedBoard', { cursor: 1, revision: page.revision }).records).toHaveLength(1);
        room.e2eeKeyHolderPeerId = 'a';
        rpc('a', 'putEncryptedBoard', { ...first, rewrap: true, encrypted: { ...first.encrypted, senderPeerId: 'a', revision: 2, epoch: Buffer.alloc(32, 6).toString('base64') } });
        expect(() => rpc('a', 'getEncryptedBoard', { cursor: 1, revision: page.revision })).toThrow('Restart');
        expect(rpc('a', 'getEncryptedBoard').records![0]).toMatchObject({ authorId: 'host', authorSigningKey: 'host-key', signingPublicKey: 'a-key', editorId: 'host', editorSigningKey: 'host-key' });
        expect(() => rpc('a', 'clearEncryptedBoard')).toThrow('host');
        rpc('host', 'clearEncryptedBoard');
        expect(rpc('a', 'getEncryptedBoard').records).toEqual([]);
    });
    it('bounds stored entries and transport sizes without committing rejected writes', () => {
        const { rpc, item } = setup();
        const now = vi.spyOn(Date, 'now');
        try {
            for (let index = 0; index < 60; index++) {
                now.mockReturnValue(10000 + index * 1000);
                rpc('host', 'putEncryptedBoard', item());
            }
            now.mockReturnValue(100000);
            expect(() => rpc('host', 'putEncryptedBoard', item())).toThrow('limit');
            expect(rpc('host', 'getEncryptedBoard').revision).toBe(60);
        } finally { now.mockRestore(); }
        const bounded = setup();
        const wide = bounded.item();
        wide.encrypted.ciphertext = Buffer.alloc(32768, 3).toString('base64');
        bounded.room.peers.get('host')!.e2eeKeyBundle!.signingPublicKey = 'x'.repeat(8192);
        expect(() => bounded.rpc('host', 'putEncryptedBoard', wide)).toThrow('message limit');
        expect(bounded.rpc('host', 'getEncryptedBoard').revision).toBe(0);
    });

});
