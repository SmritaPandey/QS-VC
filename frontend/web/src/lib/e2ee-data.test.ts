import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { E2EEManager, type E2EEKeyBundle } from './e2ee';

describe('signed encrypted meeting chat', () => {
    const host = new E2EEManager('room-a');
    const receiver = new E2EEManager('room-a');
    const other = new E2EEManager('room-a');
    let hostBundle: E2EEKeyBundle;
    let receiverBundle: E2EEKeyBundle;
    let otherBundle: E2EEKeyBundle;
    let firstKey: Awaited<ReturnType<E2EEManager['wrapMeetingKeyForPeer']>>;
    beforeAll(async () => {
        hostBundle = await host.initAsHost('host');
        receiverBundle = await receiver.init('receiver');
        otherBundle = await other.init('other');
        firstKey = await host.wrapMeetingKeyForPeer('receiver', receiverBundle.kemPublicKey);
        await receiver.acceptMeetingKey(firstKey, 'host', hostBundle.signingPublicKey, 'receiver');
        await other.acceptMeetingKey(await host.wrapMeetingKeyForPeer('other', otherBundle.kemPublicKey), 'host', hostBundle.signingPublicKey, 'other');
    });
    afterAll(() => { host.destroy(); receiver.destroy(); other.destroy(); vi.restoreAllMocks(); });

    it('delivers Unicode to recipients and sender without exposing plaintext in the envelope', async () => {
        const content = 'Private chat — नमस्ते';
        const envelope = await host.encryptChat(content);
        expect(JSON.stringify(envelope)).not.toContain(content);
        expect(await receiver.decryptChat(envelope, 'host', hostBundle.signingPublicKey)).toBe(content);
        expect(await host.decryptChat(envelope, 'host', hostBundle.signingPublicKey)).toBe(content);
    });
    it('rejects a replay and reserves concurrent duplicates before asynchronous verification', async () => {
        const envelope = await host.encryptChat('one delivery');
        const results = await Promise.allSettled([receiver.decryptChat(envelope, 'host', hostBundle.signingPublicKey), receiver.decryptChat(envelope, 'host', hostBundle.signingPublicKey)]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        await expect(receiver.decryptChat(envelope, 'host', hostBundle.signingPublicKey)).rejects.toThrow('Repeated');
    });
    it('rejects modified ciphertext, nonce and signed metadata without poisoning the valid message', async () => {
        const envelope = await host.encryptChat('tamper check');
        for (const change of [
            { ciphertext: (envelope.ciphertext[0] === 'A' ? 'B' : 'A') + envelope.ciphertext.slice(1) },
            { nonce: btoa('abcdefghijkl') }, { messageId: crypto.randomUUID() }, { createdAt: envelope.createdAt - 1 },
        ]) await expect(receiver.decryptChat({ ...envelope, ...change }, 'host', hostBundle.signingPublicKey)).rejects.toThrow();
        expect(await receiver.decryptChat(envelope, 'host', hostBundle.signingPublicKey)).toBe('tamper check');
    });
    it('rejects a wrong room, wrong sender and wrong signing identity', async () => {
        const envelope = await host.encryptChat('identity check');
        await expect(receiver.decryptChat({ ...envelope, room: 'other-room' }, 'host', hostBundle.signingPublicKey)).rejects.toThrow();
        await expect(receiver.decryptChat(envelope, 'other', hostBundle.signingPublicKey)).rejects.toThrow();
        await expect(receiver.decryptChat(envelope, 'host', otherBundle.signingPublicKey)).rejects.toThrow('verified');
    });
    it('prevents another participant sharing the MEK from impersonating the host', async () => {
        const envelope = await other.encryptChat('forged host');
        await expect(receiver.decryptChat({ ...envelope, senderPeerId: 'host' }, 'host', hostBundle.signingPublicKey)).rejects.toThrow('verified');
    });
    it('rejects expired messages and generates distinct random nonces and message IDs', async () => {
        const now = Date.now();
        const clock = vi.spyOn(Date, 'now').mockReturnValue(now - 180000);
        const expired = await host.encryptChat('too late'); clock.mockRestore();
        await expect(receiver.decryptChat(expired, 'host', hostBundle.signingPublicKey)).rejects.toThrow('expired');
        const envelopes = await Promise.all(Array.from({ length: 20 }, () => host.encryptChat('unique nonce')));
        expect(new Set(envelopes.map(value => value.nonce)).size).toBe(20);
        expect(new Set(envelopes.map(value => value.messageId)).size).toBe(20);
    });
    it('fails closed before key readiness and after destruction', async () => {
        const unready = new E2EEManager('room-a'); await unready.init('unready');
        await expect(unready.encryptChat('not ready')).rejects.toThrow('waiting');
        unready.destroy(); await expect(unready.encryptChat('destroyed')).rejects.toThrow('waiting');
    });
    it('rejects repeated authenticated MEKs, including newly wrapped copies, and rejects old data after rotation', async () => {
        await expect(receiver.acceptMeetingKey(firstKey, 'host', hostBundle.signingPublicKey, 'receiver')).rejects.toThrow('Repeated');
        await expect(receiver.acceptMeetingKey(await host.wrapMeetingKeyForPeer('receiver', receiverBundle.kemPublicKey), 'host', hostBundle.signingPublicKey, 'receiver')).rejects.toThrow('Repeated');
        const old = await host.encryptChat('old epoch');
        host.rekey();
        await receiver.acceptMeetingKey(await host.wrapMeetingKeyForPeer('receiver', receiverBundle.kemPublicKey), 'host', hostBundle.signingPublicKey, 'receiver');
        await expect(receiver.decryptChat(old, 'host', hostBundle.signingPublicKey)).rejects.toThrow('changed');
        await expect(receiver.acceptMeetingKey(firstKey, 'host', hostBundle.signingPublicKey, 'receiver')).rejects.toThrow('Repeated');
        const current = await host.encryptChat('new epoch');
        expect(await receiver.decryptChat(current, 'host', hostBundle.signingPublicKey)).toBe('new epoch');
    });
    it('keeps data epochs distinct when the media key ID wraps around its eight-bit range', async () => {
        const old = await host.encryptChat('before key-id wrap');
        for (let index = 0; index < 256; index++) host.rekey();
        expect(host.getKeyId()).toBe(old.keyId);
        await receiver.acceptMeetingKey(await host.wrapMeetingKeyForPeer('receiver', receiverBundle.kemPublicKey), 'host', hostBundle.signingPublicKey, 'receiver');
        await expect(receiver.decryptChat(old, 'host', hostBundle.signingPublicKey)).rejects.toThrow('changed');
        const current = await host.encryptChat('after key-id wrap');
        expect(current.epoch).not.toBe(old.epoch);
        expect(await receiver.decryptChat(current, 'host', hostBundle.signingPublicKey)).toBe('after key-id wrap');
    });

});


describe('encrypted room notes', () => {
    it('opens durable ciphertext after rotation, authenticates revisions and reseals it for a late join', async () => {
        const host = new E2EEManager('secure-notes');
        const late = new E2EEManager('secure-notes');
        try {
            const hostBundle = await host.initAsHost('host');
            const lateBundle = await late.init('late');
            const signingPublicKey = hostBundle.signingPublicKey;
            const text = '私のノート '.repeat(1900);
            const encrypted = await host.sealNotes(text, 1, 1);
            expect(JSON.stringify(encrypted)).not.toContain(text);
            expect(await host.openNotes({ encrypted, signingPublicKey })).toEqual({ text, currentEpoch: true });
            await expect(host.openNotes({ encrypted: { ...encrypted, revision: 2 }, signingPublicKey })).rejects.toThrow('signature');
            host.rekey();
            expect(await host.openNotes({ encrypted, signingPublicKey })).toEqual({ text, currentEpoch: false });
            await late.acceptMeetingKey(await host.wrapMeetingKeyForPeer('late', lateBundle.kemPublicKey), 'host', signingPublicKey, 'late');
            await expect(late.openNotes({ encrypted, signingPublicKey })).rejects.toThrow('sync');
            const resealed = await host.sealNotes(text, 2, 1);
            expect(await late.openNotes({ encrypted: resealed, signingPublicKey })).toEqual({ text, currentEpoch: true });
            await expect(host.sealNotes('界'.repeat(19000), 3, 2)).rejects.toThrow('limit');
            const fileId = crypto.randomUUID();
            const payload = JSON.stringify({name:'restricted.txt',data:btoa('x'.repeat(18*1024))});
            const signature = await host.signFile(fileId,payload);
            const content = JSON.stringify({payload,signature});
            expect(await late.verifyFile(fileId,payload,signature,signingPublicKey)).toBe(true);
            expect(await late.verifyFile(fileId,payload+' ',signature,signingPublicKey)).toBe(false);
            const attachment = await host.sealNotes(content,1,1,fileId);
            expect(JSON.stringify(attachment)).not.toContain('restricted.txt');
            expect(await late.openNotes({encrypted:attachment,signingPublicKey})).toMatchObject({text:content});
            await expect(late.openNotes({encrypted:{...attachment,fileId:crypto.randomUUID()},signingPublicKey})).rejects.toThrow('signature');
        } finally { host.destroy(); late.destroy(); }
    });
});
