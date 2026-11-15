/** Signed, sender-bound chat envelopes. Media keys are never used directly for data encryption. */
const encoder = new TextEncoder();
const bytes = (value: Uint8Array): ArrayBuffer => value.slice().buffer as ArrayBuffer;
const base64 = (value: Uint8Array): string => btoa(String.fromCharCode(...value));
const decode = (value: string): Uint8Array => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const LABEL = 'QS-VC-DATA:v1';
const MAX_AGE_MS = 120_000;
const MAX_REPLAYS = 4096;
export interface EncryptedChatEnvelope {
    version: 1; room: string; keyId: number; epoch: string; senderPeerId: string;
    messageId: string; type: 'chat'; createdAt: number; nonce: string; ciphertext: string; signature: string;
}
type Sign = (body: Uint8Array) => Promise<string>;
type Verify = (body: Uint8Array, signature: string, signingPublicKey: string) => Promise<boolean>;
const aad = (value: EncryptedChatEnvelope) => encoder.encode(JSON.stringify([LABEL, value.room, value.keyId, value.epoch, value.senderPeerId, value.messageId, value.type, value.createdAt]));
const signedBody = (value: EncryptedChatEnvelope) => encoder.encode(JSON.stringify([new TextDecoder().decode(aad(value)), value.nonce, value.ciphertext]));
const validBase64 = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);

export class E2EEDataCipher {
    private revision = 0;
    private installed: Promise<{ key: CryptoKey; epoch: string; keyId: number }> | null = null;
    private readonly seen = new Map<string, number>();
    private readonly pending = new Set<string>();
    constructor(private readonly room: string, private readonly peerId: string, private readonly sign: Sign, private readonly verify: Verify) {}

    install(keyId: number, mek: Uint8Array): void {
        this.revision++;
        this.seen.clear(); this.pending.clear();
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
    destroy(): void { this.revision++; this.installed = null; this.seen.clear(); this.pending.clear(); }
}
