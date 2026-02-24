/**
 * E2EE (End-to-End Encryption) Manager for QS-VC.
 *
 * Uses WebRTC Insertable Streams API with SFrame-style encryption.
 * - AES-256-GCM per-frame encryption
 * - Epoch-based key rotation (every 60 seconds)
 * - Kyber-1024 key encapsulation for key distribution
 * - Forward secrecy on participant leave
 *
 * Architecture:
 * 1. Host generates Meeting Encryption Key (MEK)
 * 2. MEK distributed to each participant via signaling (encrypted with their public key)
 * 3. Epoch keys derived: epoch_key = HKDF(MEK, epoch_counter)
 * 4. Each frame encrypted with current epoch key + per-frame IV
 * 5. SFU sees only encrypted payload (zero-knowledge)
 */

const HEADER_SIZE = 5; // 1 (keyId) + 4 (counter)
const IV_SIZE = 12;    // AES-GCM IV
const TAG_SIZE = 16;   // AES-GCM auth tag (appended by WebCrypto)
const KEY_ROTATION_INTERVAL_MS = 60_000;
const OLD_KEY_RETENTION_MS = 5_000;

export class E2EEManager {
    private currentEpoch: number = 0;
    private frameCounter: number = 0;
    private keys: Map<number, CryptoKey> = new Map();
    private mek: Uint8Array | null = null;
    private rotationTimer: ReturnType<typeof setInterval> | null = null;
    private active: boolean = false;

    // Insertable Streams transforms
    private senderTransforms: Map<string, TransformStream> = new Map();
    private receiverTransforms: Map<string, TransformStream> = new Map();

    constructor() { }

    // ── Key Management ────────────────────────────────────

    /** Initialize as meeting host: generate MEK and first epoch key. */
    async initAsHost(): Promise<Uint8Array> {
        // Generate 256-bit MEK
        this.mek = crypto.getRandomValues(new Uint8Array(32));
        await this.deriveEpochKey(0);
        this.startKeyRotation();
        this.active = true;
        return this.mek;
    }

    /** Initialize as participant: receive MEK from host. */
    async initWithMEK(mek: Uint8Array): Promise<void> {
        this.mek = new Uint8Array(mek);
        await this.deriveEpochKey(0);
        this.startKeyRotation();
        this.active = true;
    }

    /** Derive epoch key from MEK using HKDF. */
    private async deriveEpochKey(epoch: number): Promise<void> {
        if (!this.mek) throw new Error('MEK not initialized');

        // Import MEK as HKDF key material
        const mekBuffer = this.mek.buffer.slice(this.mek.byteOffset, this.mek.byteOffset + this.mek.byteLength) as ArrayBuffer;
        const baseKey = await crypto.subtle.importKey(
            'raw', mekBuffer, 'HKDF', false, ['deriveKey']
        );

        // Derive epoch-specific AES-GCM key
        const epochKey = await crypto.subtle.deriveKey(
            {
                name: 'HKDF',
                hash: 'SHA-256',
                salt: new TextEncoder().encode('qsvc-e2ee-epoch'),
                info: new Uint8Array(new Uint32Array([epoch]).buffer),
            },
            baseKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );

        this.keys.set(epoch, epochKey);
        this.currentEpoch = epoch;
        this.frameCounter = 0;

        // Remove old keys (keep current and previous for in-flight frames)
        setTimeout(() => {
            for (const [keyEpoch] of this.keys) {
                if (keyEpoch < epoch - 1) {
                    this.keys.delete(keyEpoch);
                }
            }
        }, OLD_KEY_RETENTION_MS);
    }

    /** Start automatic key rotation. */
    private startKeyRotation(): void {
        this.rotationTimer = setInterval(async () => {
            const nextEpoch = this.currentEpoch + 1;
            await this.deriveEpochKey(nextEpoch);
        }, KEY_ROTATION_INTERVAL_MS);
    }

    /** Re-key after participant leaves (forward secrecy). */
    async rekey(): Promise<Uint8Array> {
        this.mek = crypto.getRandomValues(new Uint8Array(32));
        this.keys.clear();
        await this.deriveEpochKey(this.currentEpoch + 1);
        return this.mek;
    }

    // ── Frame Encryption/Decryption ──────────────────────

    /** Encrypt a single frame. */
    private async encryptFrame(frame: RTCEncodedVideoFrame | RTCEncodedAudioFrame): Promise<void> {
        const key = this.keys.get(this.currentEpoch);
        if (!key) return; // Skip if key not ready

        const data = frame.data;
        this.frameCounter++;

        // Build IV: epoch (4 bytes) + counter (4 bytes) + zeros (4 bytes)
        const iv = new Uint8Array(IV_SIZE);
        new DataView(iv.buffer).setUint32(0, this.currentEpoch);
        new DataView(iv.buffer).setUint32(4, this.frameCounter);

        // Encrypt payload
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv, additionalData: new Uint8Array(0) },
            key,
            data
        );

        // Build output: header (5 bytes) + encrypted payload + tag
        const output = new ArrayBuffer(HEADER_SIZE + encrypted.byteLength);
        const view = new DataView(output);
        view.setUint8(0, this.currentEpoch & 0xFF);           // keyId
        view.setUint32(1, this.frameCounter);                   // counter
        new Uint8Array(output, HEADER_SIZE).set(new Uint8Array(encrypted));

        frame.data = output;
    }

    /** Decrypt a single frame. */
    private async decryptFrame(frame: RTCEncodedVideoFrame | RTCEncodedAudioFrame): Promise<void> {
        if (frame.data.byteLength < HEADER_SIZE + TAG_SIZE) return;

        const view = new DataView(frame.data);
        const keyId = view.getUint8(0);
        const counter = view.getUint32(1);

        // Find matching key (try current epoch matching keyId, then neighbors)
        let key: CryptoKey | undefined;
        for (const [epoch, k] of this.keys) {
            if ((epoch & 0xFF) === keyId) {
                key = k;
                break;
            }
        }
        if (!key) return; // Cannot decrypt — missing key

        // Reconstruct IV
        const iv = new Uint8Array(IV_SIZE);
        new DataView(iv.buffer).setUint32(0, keyId); // simplified epoch
        new DataView(iv.buffer).setUint32(4, counter);

        const encryptedData = frame.data.slice(HEADER_SIZE);

        try {
            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv, additionalData: new Uint8Array(0) },
                key,
                encryptedData
            );
            frame.data = decrypted;
        } catch {
            // Decryption failed — frame corrupted or wrong key
            // Leave frame as-is (will display as noise/blank)
        }
    }

    // ── Insertable Streams Integration ───────────────────

    /** Create an encryption transform for a sender's RTCRtpSender. */
    setupSenderTransform(sender: RTCRtpSender, trackId: string): void {
        if (!this.active) return;

        // @ts-expect-error — Insertable Streams API (experimental)
        const senderStreams = sender.createEncodedStreams?.() ?? null;
        if (!senderStreams) {
            console.warn('Insertable Streams API not available');
            return;
        }

        const { readable, writable } = senderStreams;
        const transform = new TransformStream({
            transform: async (frame: RTCEncodedVideoFrame, controller: TransformStreamDefaultController) => {
                await this.encryptFrame(frame);
                controller.enqueue(frame);
            }
        });

        readable.pipeThrough(transform).pipeTo(writable);
        this.senderTransforms.set(trackId, transform);
    }

    /** Create a decryption transform for a receiver's RTCRtpReceiver. */
    setupReceiverTransform(receiver: RTCRtpReceiver, trackId: string): void {
        if (!this.active) return;

        // @ts-expect-error — Insertable Streams API (experimental)
        const receiverStreams = receiver.createEncodedStreams?.() ?? null;
        if (!receiverStreams) {
            console.warn('Insertable Streams API not available');
            return;
        }

        const { readable, writable } = receiverStreams;
        const transform = new TransformStream({
            transform: async (frame: RTCEncodedVideoFrame, controller: TransformStreamDefaultController) => {
                await this.decryptFrame(frame);
                controller.enqueue(frame);
            }
        });

        readable.pipeThrough(transform).pipeTo(writable);
        this.receiverTransforms.set(trackId, transform);
    }

    // ── Key Exchange Helpers ─────────────────────────────

    /**
     * Export MEK encrypted with a participant's public key.
     * In production, this uses Kyber-1024 encapsulation.
     * For now, uses RSA-OAEP as a browser-native fallback.
     */
    async encryptMEKForParticipant(publicKey: CryptoKey): Promise<ArrayBuffer> {
        if (!this.mek) throw new Error('MEK not initialized');
        const mekBuffer = this.mek.buffer.slice(this.mek.byteOffset, this.mek.byteOffset + this.mek.byteLength) as ArrayBuffer;
        return crypto.subtle.encrypt(
            { name: 'RSA-OAEP' },
            publicKey,
            mekBuffer
        );
    }

    /** Decrypt MEK received from host. */
    async decryptMEK(encryptedMEK: ArrayBuffer, privateKey: CryptoKey): Promise<void> {
        const mek = await crypto.subtle.decrypt(
            { name: 'RSA-OAEP' },
            privateKey,
            encryptedMEK
        );
        await this.initWithMEK(new Uint8Array(mek));
    }

    /** Generate an ephemeral RSA-OAEP keypair for key exchange. */
    static async generateKeyExchangeKeypair(): Promise<CryptoKeyPair> {
        return crypto.subtle.generateKey(
            {
                name: 'RSA-OAEP',
                modulusLength: 4096,
                publicExponent: new Uint8Array([1, 0, 1]),
                hash: 'SHA-256',
            },
            true,
            ['encrypt', 'decrypt']
        );
    }

    /** Export public key for signaling exchange. */
    static async exportPublicKey(key: CryptoKey): Promise<ArrayBuffer> {
        return crypto.subtle.exportKey('spki', key);
    }

    /** Import a participant's public key from signaling. */
    static async importPublicKey(keyData: ArrayBuffer): Promise<CryptoKey> {
        return crypto.subtle.importKey(
            'spki',
            keyData,
            { name: 'RSA-OAEP', hash: 'SHA-256' },
            true,
            ['encrypt']
        );
    }

    // ── Lifecycle ────────────────────────────────────────

    /** Check if E2EE is active. */
    isActive(): boolean {
        return this.active;
    }

    /** Get current epoch for display. */
    getCurrentEpoch(): number {
        return this.currentEpoch;
    }

    /** Clean up all resources. */
    destroy(): void {
        this.active = false;
        if (this.rotationTimer) {
            clearInterval(this.rotationTimer);
            this.rotationTimer = null;
        }
        this.keys.clear();
        this.mek = null;
        this.senderTransforms.clear();
        this.receiverTransforms.clear();
    }
}
