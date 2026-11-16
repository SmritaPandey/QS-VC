import type { E2EEManager } from './e2ee';
import type { EncryptedNotesRecord } from './e2ee-data';
import { EMPTY_COLLABORATION, type CollaborationState } from './collaboration-state';
import { signaling } from './signaling';

export interface EncryptedNotesAccess {
    manager: E2EEManager;
    isKeyHolder: () => boolean;
    signingKeyFor: (peerId: string) => string | undefined;
}

export async function readEncryptedNotes(access: EncryptedNotesAccess, record: EncryptedNotesRecord | null): Promise<CollaborationState> {
    if (!record) return { ...EMPTY_COLLABORATION, revision: 0 };
    const { encrypted } = record;
    if (encrypted.fileId !== undefined) throw new Error('Invalid secure notes record.');
    const knownKey = access.signingKeyFor(encrypted.senderPeerId);
    if (knownKey && knownKey !== record.signingPublicKey) throw new Error('The notes author’s verification key changed.');
    const { text, currentEpoch } = await access.manager.openNotes(record);
    const { noteVersion, revision } = encrypted;
    if (!currentEpoch && access.isKeyHolder()) {
        // A storage-only revision preserves in-progress edits based on the same note version.
        const resealed = await access.manager.sealNotes(text, revision + 1, noteVersion);
        await signaling.request('putEncryptedNotes', resealed);
        return { ...EMPTY_COLLABORATION, revision: resealed.revision, notes: { text, version: noteVersion } };
    }
    return { ...EMPTY_COLLABORATION, revision, notes: { text, version: noteVersion } };
}

export async function saveEncryptedNotes(access: EncryptedNotesAccess, text: string, current: CollaborationState): Promise<CollaborationState> {
    if (current.revision < 0) throw new Error('Wait for the latest secure notes before saving.');
    const encrypted = await access.manager.sealNotes(text, current.revision + 1, current.notes.version + 1);
    await signaling.request('putEncryptedNotes', encrypted);
    return { ...EMPTY_COLLABORATION, revision: encrypted.revision, notes: { text, version: encrypted.noteVersion } };
}
