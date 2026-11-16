import { afterEach, describe, expect, it, vi } from 'vitest';
import { E2EEManager } from './e2ee';
import { actEncryptedBoard, readEncryptedBoard, type EncryptedBoardRecord, type EncryptedBoardState } from './encrypted-board';
import type { EncryptedNotesAccess } from './encrypted-notes';
import { signaling } from './signaling';

const empty = (): EncryptedBoardState => ({ revision: 0, strokes: [], stickyNotes: [], records: new Map() });
afterEach(() => vi.restoreAllMocks());

describe('encrypted board adapter', () => {
    it('shares authenticated content, rejects stale drafts and tampering, and reseals authored notes for late joiners', async () => {
        const host = new E2EEManager('board-room');
        const attendee = new E2EEManager('board-room');
        const late = new E2EEManager('board-room');
        try {
            const hostBundle = await host.initAsHost('host');
            const attendeeBundle = await attendee.init('attendee');
            await attendee.acceptMeetingKey(await host.wrapMeetingKeyForPeer('attendee', attendeeBundle.kemPublicKey), 'host', hostBundle.signingPublicKey, 'attendee');
            const signingKeys = new Map([['host', hostBundle.signingPublicKey], ['attendee', attendeeBundle.signingPublicKey]]);
            const hostAccess: EncryptedNotesAccess = { manager: host, isKeyHolder: () => true, signingKeyFor: peer => signingKeys.get(peer) };
            const attendeeAccess: EncryptedNotesAccess = { manager: attendee, isKeyHolder: () => false, signingKeyFor: peer => signingKeys.get(peer) };
            const stored = new Map<string, EncryptedBoardRecord>();
            let revision = 0;
            vi.spyOn(signaling, 'request').mockImplementation(async (method, params: any = {}) => {
                if (method === 'getEncryptedBoard') {
                    if (params.cursor && params.revision !== revision) throw new Error('Whiteboard changed. Restart from the first page.');
                    const records = [...stored.values()];
                    const cursor = params.cursor ?? 0;
                    return { records: records.slice(cursor, cursor + 1), nextCursor: cursor + 1 < records.length ? cursor + 1 : null, revision };
                }
                if (method === 'putEncryptedBoard') {
                    const { encrypted, kind, rewrap } = params;
                    const id = encrypted.fileId;
                    const existing = stored.get(id);
                    if (encrypted.revision !== (existing?.encrypted.revision ?? 0) + 1) throw new Error('Board version changed');
                    const editor = encrypted.senderPeerId;
                    stored.set(id, {
                        kind, encrypted, signingPublicKey: signingKeys.get(editor)!,
                        authorId: existing?.authorId ?? editor, authorName: existing?.authorName ?? editor,
                        editorId: rewrap ? existing!.editorId : editor,
                        editorSigningKey: rewrap ? existing!.editorSigningKey : signingKeys.get(editor)!,
                    });
                    return { revision: ++revision };
                }
                if (method === 'removeEncryptedBoard') {
                    if (stored.get(params.id)?.encrypted.revision !== params.revision) throw new Error('Board version changed');
                    stored.delete(params.id);
                    return { revision: ++revision };
                }
                if (method === 'clearEncryptedBoard') { stored.clear(); return { revision: ++revision }; }
                throw new Error('Unexpected RPC');
            });
            let current = await actEncryptedBoard(attendeeAccess, { type: 'sticky:add', text: 'Private board idea', color: 'yellow' }, empty(), 'attendee');
            expect(JSON.stringify([...stored.values()])).not.toContain('Private board idea');
            const first = current.stickyNotes[0];
            expect(first).toMatchObject({ text: 'Private board idea', authorId: 'attendee', version: 0 });
            const stale = current;
            current = await actEncryptedBoard(hostAccess, { type: 'sticky:update', id: first.id, version: 0, text: 'Host revised idea', color: 'blue' }, current, 'host');
            expect(current.stickyNotes[0]).toMatchObject({ authorId: 'attendee', text: 'Host revised idea', version: 1 });
            await expect(actEncryptedBoard(attendeeAccess, { type: 'sticky:update', id: first.id, version: 0, text: 'Overwrite', color: 'yellow' }, stale, 'attendee')).rejects.toThrow('version changed');
            const original = stored.get(first.id)!;
            stored.set(first.id, { ...original, kind: 'stroke' });
            await expect(readEncryptedBoard(hostAccess)).rejects.toThrow('content');
            stored.set(first.id, original);
            host.rekey();
            const lateBundle = await late.init('late');
            await late.acceptMeetingKey(await host.wrapMeetingKeyForPeer('late', lateBundle.kemPublicKey), 'host', hostBundle.signingPublicKey, 'late');
            const lateAccess: EncryptedNotesAccess = { manager: late, isKeyHolder: () => false, signingKeyFor: peer => signingKeys.get(peer) };
            await expect(readEncryptedBoard(lateAccess)).rejects.toThrow('sync');
            current = await readEncryptedBoard(hostAccess);
            expect(current.stickyNotes[0].version).toBe(1);
            expect((await readEncryptedBoard(lateAccess)).stickyNotes[0].text).toBe('Host revised idea');
            expect(stored.get(first.id)?.editorId).toBe('host');
            current = await actEncryptedBoard(hostAccess, { type: 'stroke:add', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: '#006d77', width: 3 }, current, 'host');
            expect(current.strokes).toHaveLength(1);
            await expect(actEncryptedBoard(hostAccess, { type: 'stroke:add', points: [{ x: 2, y: 0 }, { x: 1, y: 1 }], color: '#006d77', width: 3 }, current, 'host')).rejects.toThrow('stroke');
            current = await actEncryptedBoard(hostAccess, { type: 'stroke:undo', id: current.strokes[0].id }, current, 'host');
            expect(current.strokes).toHaveLength(0);
            current = await actEncryptedBoard(hostAccess, { type: 'board:clear' }, current, 'host');
            expect(current.stickyNotes).toHaveLength(0);
        } finally { host.destroy(); attendee.destroy(); late.destroy(); }
    });

    it('bounds revision-churn retries and rejects non-progressing pagination', async () => {
        const access = { manager: {}, isKeyHolder: () => false, signingKeyFor: () => undefined } as unknown as EncryptedNotesAccess;
        const request = vi.spyOn(signaling, 'request');
        let count = 0;
        request.mockImplementation(async (_method, params: any) => {
            if (params.cursor > 0) throw new Error('Whiteboard changed. Restart from the first page.');
            return { revision: ++count, records: [], nextCursor: 1 };
        });
        await expect(readEncryptedBoard(access)).rejects.toThrow('changed while loading');
        expect(request).toHaveBeenCalledTimes(6);
        request.mockResolvedValue({ revision: 1, records: [], nextCursor: 0 });
        await expect(readEncryptedBoard(access)).rejects.toThrow('page');
    });
});
