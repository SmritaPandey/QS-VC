import { describe, expect, it } from 'vitest';
import { E2EEManager } from './e2ee';

describe('meeting E2EE key exchange', () => {
    it('wraps a fresh group key to a participant using ML-KEM and authenticates the envelope with ML-DSA', async () => {
        const host = new E2EEManager('QS-TEST-ROOM');
        const guest = new E2EEManager('QS-TEST-ROOM');
        const hostBundle = await host.initAsHost();
        const guestBundle = await guest.initAsParticipant();

        expect(await guest.verifyKeyBundle(hostBundle)).toBe(true);
        expect(await host.verifyKeyBundle(guestBundle)).toBe(true);
        const envelope = await host.wrapMeetingKeyForPeer('guest-peer', guestBundle.kemPublicKey);
        await expect(guest.acceptMeetingKey({ ...envelope, targetPeerId: 'other-peer' }, 'host-peer', hostBundle.signingPublicKey, 'guest-peer'))
            .rejects.toThrow('addressed to another participant');
        await guest.acceptMeetingKey(envelope, 'host-peer', hostBundle.signingPublicKey, 'guest-peer');

        expect(host.isActive()).toBe(true);
        expect(guest.isActive()).toBe(true);
        host.destroy();
        guest.destroy();
    });

    it('rejects a modified group-key envelope before accepting the key', async () => {
        const host = new E2EEManager('QS-TEST-ROOM');
        const guest = new E2EEManager('QS-TEST-ROOM');
        const hostBundle = await host.initAsHost();
        const guestBundle = await guest.initAsParticipant();
        const envelope = await host.wrapMeetingKeyForPeer('guest-peer', guestBundle.kemPublicKey);

        await expect(guest.acceptMeetingKey({ ...envelope, encryptedKey: `${envelope.encryptedKey.slice(0, -4)}AAAA` }, 'host-peer', hostBundle.signingPublicKey, 'guest-peer'))
            .rejects.toThrow('signature');
        expect(guest.isActive()).toBe(false);
        host.destroy();
        guest.destroy();
    });
});
