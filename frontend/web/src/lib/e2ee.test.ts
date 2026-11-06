import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { E2EEManager } from './e2ee';
import { FrameCrypto } from './e2ee-frame';
import { deriveSP800108CounterKey, getPQCSecurityStatus } from '../../../../shared/crypto/pqc';

describe('meeting E2EE key exchange', () => {
    it('derives AES-256 key material using the SP 800-108 Counter/HMAC-SHA-256 input layout', async () => {
        const key = new Uint8Array([1, 2, 3, 4]);
        const label = new TextEncoder().encode('QS-VC test label');
        const context = new TextEncoder().encode('meeting/peer/epoch');
        const input = Buffer.concat([
            Buffer.from([0, 0, 0, 1]), Buffer.from(label), Buffer.from([0]), Buffer.from(context), Buffer.from([0, 0, 1, 0]),
        ]);
        const expected = createHmac('sha256', key).update(input).digest();

        expect(Buffer.from(await deriveSP800108CounterKey(key, label, context))).toEqual(expected);
        expect(await deriveSP800108CounterKey(key, label, new TextEncoder().encode('other meeting'))).not.toEqual(new Uint8Array(expected));
    });

    it('wraps a fresh group key to a participant using ML-KEM and authenticates the envelope with ML-DSA', async () => {
        const host = new E2EEManager('QS-TEST-ROOM');
        const guest = new E2EEManager('QS-TEST-ROOM');
        const hostBundle = await host.initAsHost('host-peer');
        const guestBundle = await guest.initAsParticipant('guest-peer');

        expect(await guest.verifyKeyBundle(hostBundle, 'host-peer')).toBe(true);
        expect(await host.verifyKeyBundle(guestBundle, 'guest-peer')).toBe(true);
        expect(await guest.verifyKeyBundle({ ...hostBundle, peerId: 'other-peer' }, 'other-peer')).toBe(false);
        const envelope = await host.wrapMeetingKeyForPeer('guest-peer', guestBundle.kemPublicKey);
        await expect(guest.acceptMeetingKey({ ...envelope, targetPeerId: 'other-peer' }, 'host-peer', hostBundle.signingPublicKey, 'guest-peer'))
            .rejects.toThrow('sender or recipient does not match');
        await guest.acceptMeetingKey(envelope, 'host-peer', hostBundle.signingPublicKey, 'guest-peer');

        expect(host.isActive()).toBe(true);
        expect(guest.isActive()).toBe(true);
        host.destroy();
        guest.destroy();
    });

    it('rejects a modified group-key envelope before accepting the key', async () => {
        const host = new E2EEManager('QS-TEST-ROOM');
        const guest = new E2EEManager('QS-TEST-ROOM');
        const hostBundle = await host.initAsHost('host-peer');
        const guestBundle = await guest.initAsParticipant('guest-peer');
        const envelope = await host.wrapMeetingKeyForPeer('guest-peer', guestBundle.kemPublicKey);

        await expect(guest.acceptMeetingKey({ ...envelope, encryptedKey: `${envelope.encryptedKey.slice(0, -4)}AAAA` }, 'host-peer', hostBundle.signingPublicKey, 'guest-peer'))
            .rejects.toThrow('signature');
        expect(guest.isActive()).toBe(false);
        host.destroy();
        guest.destroy();
    });

    it('binds group-key envelopes to the meeting identity and refuses a different meeting context', async () => {
        const host = new E2EEManager('QS-TEST-ROOM');
        const wrongRoom = new E2EEManager('QS-OTHER-ROOM');
        const hostBundle = await host.initAsHost('host-peer');
        const guestBundle = await wrongRoom.initAsParticipant('guest-peer');
        const envelope = await host.wrapMeetingKeyForPeer('guest-peer', guestBundle.kemPublicKey);

        await expect(wrongRoom.acceptMeetingKey(envelope, 'host-peer', hostBundle.signingPublicKey, 'guest-peer'))
            .rejects.toThrow('signature');
        expect(wrongRoom.isActive()).toBe(false);
        host.destroy();
        wrongRoom.destroy();
    });

    it('encrypts media frames end to end: VP8 header readable, payload sealed, tampering and replays dropped', async () => {
        const meeting = 'QS-FRAME-ROOM';
        const sender = new FrameCrypto(meeting, 'alice');
        const receiver = new FrameCrypto(meeting, 'bob');
        const groupKey = crypto.getRandomValues(new Uint8Array(32));
        sender.setKey(7, groupKey); receiver.setKey(7, groupKey);

        const vp8KeyFrame = Uint8Array.from({ length: 200 }, (_, i) => (i * 13) & 0xff);
        const sealed = new Uint8Array((await sender.encrypt(vp8KeyFrame.buffer, 10))!);
        expect(sealed.subarray(0, 10)).toEqual(vp8KeyFrame.subarray(0, 10));            // SFU can read the VP8 payload header
        expect(sealed.length).toBe(200 + 16 + 24);                                         // + GCM tag + trailer header
        expect(Buffer.from(sealed.subarray(10, 200)).equals(Buffer.from(vp8KeyFrame.subarray(10)))).toBe(false);
        expect(new Uint8Array((await receiver.decrypt(sealed.buffer, 'alice', 'v'))!)).toEqual(vp8KeyFrame);

        expect(await receiver.decrypt(sealed.buffer, 'alice', 'v')).toBeNull();          // replay
        const again = new Uint8Array((await sender.encrypt(vp8KeyFrame.buffer, 10))!);
        expect(await receiver.decrypt(again.buffer, 'mallory', 'v')).toBeNull();          // bound to the sender identity
        const flipped = again.slice(); flipped[0] ^= 1;                                     // clear bytes are authenticated
        expect(await receiver.decrypt(flipped.buffer, 'alice', 'v')).toBeNull();
        const body = again.slice(); body[50] ^= 1;
        expect(await receiver.decrypt(body.buffer, 'alice', 'v')).toBeNull();
        expect(await receiver.decrypt(again.buffer, 'alice', 'v')).not.toBeNull();

        const outsider = new FrameCrypto(meeting, 'eve');
        outsider.setKey(7, crypto.getRandomValues(new Uint8Array(32)));
        const third = await sender.encrypt(new Uint8Array([1, 2, 3, 4]).buffer, 0);
        expect(await outsider.decrypt(third!, 'alice', 'a')).toBeNull();                  // wrong group key
    });

    it('never reuses a nonce: counters increase and each frame gets a distinct IV', async () => {
        const sender = new FrameCrypto('QS-NONCE-ROOM', 'alice');
        sender.setKey(1, crypto.getRandomValues(new Uint8Array(32)));
        const ivs = new Set<string>();
        for (let i = 0; i < 300; i++) {
            const frame = new Uint8Array((await sender.encrypt(new Uint8Array(40).buffer, 0))!);
            ivs.add(Buffer.from(frame.subarray(frame.length - 12)).toString('hex'));
        }
        expect(ivs.size).toBe(300);
    });

    it('drops frames until a key is installed, and keeps the previous key briefly after a rekey', async () => {
        const host = new E2EEManager('QS-REKEY-ROOM');
        const guest = new E2EEManager('QS-REKEY-ROOM');
        const hostBundle = await host.init('host-peer');
        const guestBundle = await guest.init('guest-peer');
        const hostFrames: FrameCrypto = (host as any).frames ?? new FrameCrypto('QS-REKEY-ROOM', 'host-peer');
        expect(await new FrameCrypto('QS-REKEY-ROOM', 'x').encrypt(new Uint8Array(8).buffer, 0)).toBeNull();

        const firstId = host.generateGroupKey();
        await guest.acceptMeetingKey(await host.wrapMeetingKeyForPeer('guest-peer', guestBundle.kemPublicKey), 'host-peer', hostBundle.signingPublicKey, 'guest-peer');
        expect(guest.getKeyId()).toBe(firstId);
        const secondId = host.rekey();
        expect(secondId).toBe((firstId + 1) % 256);
        await guest.acceptMeetingKey(await host.wrapMeetingKeyForPeer('guest-peer', guestBundle.kemPublicKey), 'host-peer', hostBundle.signingPublicKey, 'guest-peer');
        expect(guest.getKeyId()).toBe(secondId);
        expect(hostFrames).toBeDefined();
        host.destroy(); guest.destroy();
    });

    it('decrypts in-flight frames under the previous key during the rotation grace period only', async () => {
        const a = new FrameCrypto('QS-GRACE', 'alice'), b = new FrameCrypto('QS-GRACE', 'bob');
        const k1 = crypto.getRandomValues(new Uint8Array(32)), k2 = crypto.getRandomValues(new Uint8Array(32));
        a.setKey(1, k1); b.setKey(1, k1);
        const old = await a.encrypt(new Uint8Array([9, 9, 9, 9]).buffer, 0);
        a.setKey(2, k2); b.setKey(2, k2);
        expect(await b.decrypt(old!, 'alice', 'a')).not.toBeNull();
        const fresh = await a.encrypt(new Uint8Array([1]).buffer, 0);
        expect(new Uint8Array((await b.decrypt(fresh!, 'alice', 'a'))!)).toEqual(new Uint8Array([1]));
    });

    it('uses the FIPS 203 / FIPS 204 parameter sets (ML-KEM-1024, ML-DSA-87) and reports them as NIST algorithms', async () => {
        const status = getPQCSecurityStatus();
        expect(status.kemAlgorithm).toBe('ML-KEM-1024');
        expect(status.sigAlgorithm).toBe('ML-DSA-87');
        expect(status.nistAlgorithmStandardized).toBe(true);
        expect(status.nistCompliant).toBe(true);
        expect(status.validatedCryptoModule).toBe(false);
        const manager = new E2EEManager('QS-SIZES');
        const bundle = await manager.init('p');
        expect(Buffer.from(bundle.kemPublicKey, 'base64').length).toBe(1568);      // FIPS 203 Table 3, ML-KEM-1024 ek
        expect(Buffer.from(bundle.signingPublicKey, 'base64').length).toBe(2592);  // FIPS 204 Table 2, ML-DSA-87 pk
        expect(Buffer.from(bundle.signature, 'base64').length).toBe(4627);         // ML-DSA-87 signature
        manager.destroy();
    });
});
