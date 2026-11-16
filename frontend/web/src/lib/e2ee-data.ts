/** Signed, sender-bound chat envelopes. Media keys are never used directly for data encryption. */
const encoder = new TextEncoder();
const bytes = (value: Uint8Array): ArrayBuffer => value.slice().buffer as ArrayBuffer;
const base64 = (value: Uint8Array): string => btoa(value.reduce((text, byte) => text + String.fromCharCode(byte), ''));
const decode = (value: string): Uint8Array => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const LABEL = 'QS-VC-DATA:v1';
const MAX_AGE_MS = 120_000;
const MAX_REPLAYS = 4096;
export interface EncryptedChatEnvelope {
    version: 1; room: string; keyId: number; epoch: string; senderPeerId: string;
    messageId: string; type: 'chat'; createdAt: number; nonce: string; ciphertext: string; signature: string;
}
export interface EncryptedNotesEnvelope {
    version: 1; room: string; epoch: string; senderPeerId: string;
    revision: number; noteVersion: number; fileId?: string; nonce: string; ciphertext: string; signature: string;
}
export interface EncryptedNotesRecord {
    encrypted: EncryptedNotesEnvelope;
    signingPublicKey: string;
}
export const MAX_SECURE_NOTES_BYTES = 32 * 1024;
const NOTES_LABEL = 'QS-VC-NOTES:v1';
const notesAad = (value: EncryptedNotesEnvelope) => encoder.encode(JSON.stringify([
    NOTES_LABEL, value.room, value.epoch, value.senderPeerId, value.revision, value.noteVersion,
    ...(value.fileId ? ['attachment', value.fileId] : []),
]));
const signedNotes = (value: EncryptedNotesEnvelope) => encoder.encode(JSON.stringify([
    new TextDecoder().decode(notesAad(value)), value.nonce, value.ciphertext,
]));
type Sign = (body: Uint8Array) => Promise<string>;
type Verify = (body: Uint8Array, signature: string, signingPublicKey: string) => Promise<boolean>;
const aad = (value: EncryptedChatEnvelope) => encoder.encode(JSON.stringify([LABEL, value.room, value.keyId, value.epoch, value.senderPeerId, value.messageId, value.type, value.createdAt]));
const signedBody = (value: EncryptedChatEnvelope) => encoder.encode(JSON.stringify([new TextDecoder().decode(aad(value)), value.nonce, value.ciphertext]));
const validBase64 = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);

export class E2EEDataCipher {
    private revision = 0;
    private installed: Promise<{ key: CryptoKey; epoch: string; keyId: number }> | null = null;
    private previousNotesKey: typeof this.installed = null;
    private readonly seen = new Map<string, number>();
    private readonly pending = new Set<string>();
    constructor(private readonly room: string, private readonly peerId: string, private readonly sign: Sign, private readonly verify: Verify) {}

    install(keyId: number, mek: Uint8Array): void {
        this.revision++;
        this.seen.clear(); this.pending.clear();
        this.previousNotesKey = this.installed;
        const copy = mek.slice();
        this.installed = (async () => {
            try {
                const key = await crypto.subtle.importKey('raw', bytes(copy), 'HKDF', false, ['deriveKey']);
                const epoch = base64(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(copy))));
                return { key, epoch, keyId };
            } finally { copy.fill(0); }
        })();
    }
    private async senderKey(state: { key: CryptoKey; epoch: string; keyId: number }, sender: string): Promise<CryptoKey> {
        return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: bytes(encoder.encode(JSON.stringify([LABEL, this.room, state.keyId, state.epoch]))), info: bytes(encoder.encode(JSON.stringify(['chat', sender]))) }, state.key, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }
    async encrypt(content: string): Promise<EncryptedChatEnvelope> {
        if (!content.trim() || content.length > 4000) throw new Error('Chat messages must contain between 1 and 4000 characters.');
        const revision = this.revision;
        const state = await this.installed;
        if (!state) throw new Error('Secure chat is waiting for the meeting key.');
        const value: EncryptedChatEnvelope = { version: 1, room: this.room, keyId: state.keyId, epoch: state.epoch, senderPeerId: this.peerId, messageId: crypto.randomUUID(), type: 'chat', createdAt: Date.now(), nonce: base64(crypto.getRandomValues(new Uint8Array(12))), ciphertext: '', signature: '' };
        const key = await this.senderKey(state, this.peerId);
        value.ciphertext = base64(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bytes(decode(value.nonce)), additionalData: bytes(aad(value)) }, key, bytes(encoder.encode(content)))));
        value.signature = await this.sign(signedBody(value));
        if (revision !== this.revision || !this.installed) throw new Error('The meeting key changed. Send your message again.');
        return value;
    }
    async decrypt(value: EncryptedChatEnvelope, expectedSender: string, signingPublicKey: string): Promise<string> {
        if (!value || value.version !== 1 || value.type !== 'chat' || value.room !== this.room || value.senderPeerId !== expectedSender || typeof value.messageId !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.messageId) || !Number.isInteger(value.createdAt) || !validBase64(value.epoch,44) || !validBase64(value.nonce,16) || decode(value.nonce).length !== 12 || !validBase64(value.ciphertext,22000) || !validBase64(value.signature,8192)) throw new Error('Invalid secure chat envelope.');
        const revision = this.revision;
        const state = await this.installed;
        if (!state || value.keyId !== state.keyId || value.epoch !== state.epoch) throw new Error('Secure chat key is not ready or has changed.');
        const now = Date.now();
        if (value.createdAt < now - MAX_AGE_MS || value.createdAt > now + 30_000) throw new Error('Secure chat message has expired.');
        for (const [id, expiry] of this.seen) if (expiry < now) this.seen.delete(id);
        const replayId = `${expectedSender}:${value.messageId}`;
        if (this.seen.has(replayId) || this.pending.has(replayId)) throw new Error('Repeated secure chat message.');
        if (this.seen.size + this.pending.size >= MAX_REPLAYS) throw new Error('Secure chat is busy. Please wait a moment.');
        this.pending.add(replayId);
        try {
            if (!await this.verify(signedBody(value), value.signature, signingPublicKey)) throw new Error('Secure chat sender could not be verified.');
            const key = await this.senderKey(state, expectedSender);
            const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(decode(value.nonce)), additionalData: bytes(aad(value)) }, key, bytes(decode(value.ciphertext)));
            const content = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
            if (!content.trim() || content.length > 4000 || revision !== this.revision || !this.installed) throw new Error('Secure chat message is unavailable.');
            this.seen.set(replayId, value.createdAt + MAX_AGE_MS);
            return content;
        } finally { this.pending.delete(replayId); }
    }
    private notesKey(state: { key: CryptoKey; epoch: string }, sender: string, fileId?: string): Promise<CryptoKey> {
        return crypto.subtle.deriveKey({
            name: 'HKDF', hash: 'SHA-256',
            salt: bytes(encoder.encode(JSON.stringify([NOTES_LABEL, this.room, state.epoch, ...(fileId ? ['attachment', fileId] : [])]))),
            info: bytes(encoder.encode(sender)),
        }, state.key, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }

    async sealNotes(text: string, revision: number, noteVersion: number, fileId?: string): Promise<EncryptedNotesEnvelope> {
        const plaintext = encoder.encode(text);
        if ((!fileId && text.length > 20000) || plaintext.length > MAX_SECURE_NOTES_BYTES) throw new Error('Secure notes exceed the room limit.');
        const generation = this.revision;
        const state = await this.installed;
        if (!state) throw new Error('Waiting for the meeting key.');
        const value: EncryptedNotesEnvelope = {
            version: 1, room: this.room, epoch: state.epoch, senderPeerId: this.peerId, revision, noteVersion,
            nonce: base64(crypto.getRandomValues(new Uint8Array(12))), ciphertext: '', signature: '',
            ...(fileId ? { fileId } : {}),
        };
        const key = await this.notesKey(state, this.peerId, fileId);
        value.ciphertext = base64(new Uint8Array(await crypto.subtle.encrypt({
            name: 'AES-GCM', iv: bytes(decode(value.nonce)), additionalData: bytes(notesAad(value)),
        }, key, bytes(plaintext))));
        value.signature = await this.sign(signedNotes(value));
        if (generation !== this.revision) throw new Error('The meeting key changed. Save again.');
        return value;
    }

    async openNotes({ encrypted: value, signingPublicKey }: EncryptedNotesRecord): Promise<{ text: string; currentEpoch: boolean }> {
        if (!value || value.version !== 1 || value.room !== this.room ||
            !Number.isSafeInteger(value.revision) || value.revision < 1 ||
            (value.fileId !== undefined && !/^[0-9a-f-]{36}$/i.test(value.fileId)) ||
            !Number.isSafeInteger(value.noteVersion) || value.noteVersion < 1 || value.noteVersion > value.revision ||
            !validBase64(value.epoch, 44) || !validBase64(value.nonce, 16) || decode(value.nonce).length !== 12 ||
            !validBase64(value.ciphertext, 43712) || !validBase64(value.signature, 8192)) throw new Error('Invalid secure notes.');
        const generation = this.revision;
        const current = await this.installed;
        const previous = await this.previousNotesKey;
        const state = current?.epoch === value.epoch ? current : previous?.epoch === value.epoch ? previous : null;
        if (!state) throw new Error('Waiting for notes to sync with the meeting key.');
        if (!await this.verify(signedNotes(value), value.signature, signingPublicKey)) throw new Error('Secure notes signature could not be verified.');
        const key = await this.notesKey(state, value.senderPeerId, value.fileId);
        const plaintext = await crypto.subtle.decrypt({
            name: 'AES-GCM', iv: bytes(decode(value.nonce)), additionalData: bytes(notesAad(value)),
        }, key, bytes(decode(value.ciphertext)));
        if (generation !== this.revision) throw new Error('The meeting key changed while loading notes.');
        return { text: new TextDecoder('utf-8', { fatal: true }).decode(plaintext), currentEpoch: state === current };
    }
    destroy(): void { this.revision++; this.installed = null; this.previousNotesKey = null; this.seen.clear(); this.pending.clear(); }
}
