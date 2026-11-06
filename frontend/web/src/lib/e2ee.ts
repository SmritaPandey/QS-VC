import { PQCManager, PQC_ALGORITHMS, type PQCSignature } from '../../../../shared/crypto/pqc';

const HEADER_BYTES = 16;
const KEY_ROTATION_MS = 60_000;
const encoder = new TextEncoder();
const arrayBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

export interface E2EEKeyBundle {
    kemPublicKey: string;
    signingPublicKey: string;
    signature: string;
}

export interface E2EEKeyEnvelope {
    targetPeerId: string;
    ciphertext: string;
    iv: string;
    encryptedKey: string;
    signature: string;
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const signatureRecord = (signature: string): PQCSignature => ({
    algorithm: PQC_ALGORITHMS.SIG_ML_DSA_87, signature: fromBase64(signature), publicKey: new Uint8Array(), timestamp: 0,
});

const MAX_CLEAR_BYTES = 10;
type EncodedFrame = RTCEncodedVideoFrame | RTCEncodedAudioFrame;
type EncodedStreams = { readable: ReadableStream<EncodedFrame>; writable: WritableStream<EncodedFrame> };

/** Bytes left readable for the SFU: VP8 key frame 10, delta 3, Opus 1 (same split as Jitsi's E2EE). */
function clearPrefixLength(frame: EncodedFrame): number {
    const type = (frame as RTCEncodedVideoFrame).type;
    if (type === 'key') return 10;
    if (type === 'delta') return 3;
    if (type === 'empty') return 0;
    return 1;
}

/** Chrome/Edge expose encoded streams on RTCRtpSender; Safari and Firefox need RTCRtpScriptTransform instead. */
export function encodedTransformsSupported(): boolean {
    return typeof RTCRtpSender !== 'undefined' && 'createEncodedStreams' in RTCRtpSender.prototype;
}

export class E2EEManager {
    private readonly pqc = new PQCManager();
    private readonly epochKeys = new Map<string, CryptoKey>();
    private readonly senderPrefix = crypto.getRandomValues(new Uint8Array(8));
    private mek: Uint8Array | null = null;
    private active = false;
    private resolveReady!: () => void;
    private readonly ready = new Promise<void>(resolve => { this.resolveReady = resolve; });
    private frameCounter = 0;
    private frameEpoch = -1;

    constructor(private readonly meetingCode: string) { }

    async initAsHost(): Promise<E2EEKeyBundle> {
        await this.pqc.init();
        this.mek = crypto.getRandomValues(new Uint8Array(32));
        this.activate();
        return this.createKeyBundle();
    }

    async initAsParticipant(): Promise<E2EEKeyBundle> {
        await this.pqc.init();
        return this.createKeyBundle();
    }

    private async createKeyBundle(): Promise<E2EEKeyBundle> {
        const kemPublicKey = toBase64(this.pqc.getPublicKey());
        const signingPublicKey = toBase64(this.pqc.getSigningPublicKey());
        const signature = await this.pqc.sign(encoder.encode(`${this.meetingCode}|${kemPublicKey}|${signingPublicKey}`));
        return { kemPublicKey, signingPublicKey, signature: toBase64(signature.signature) };
    }

    async verifyKeyBundle(bundle: E2EEKeyBundle): Promise<boolean> {
        try {
            return await this.pqc.verify(
                encoder.encode(`${this.meetingCode}|${bundle.kemPublicKey}|${bundle.signingPublicKey}`),
                signatureRecord(bundle.signature), fromBase64(bundle.signingPublicKey),
            );
        } catch { return false; }
    }

    async wrapMeetingKeyForPeer(targetPeerId: string, kemPublicKey: string): Promise<E2EEKeyEnvelope> {
        if (!this.mek || !this.active) throw new Error('Meeting encryption is not ready');
        const capsule = await this.pqc.encapsulateForPeer(fromBase64(kemPublicKey));
        const wrappingKey = await crypto.subtle.importKey('raw', arrayBuffer(capsule.combinedSecret), 'AES-GCM', false, ['encrypt']);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encryptedKey = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: arrayBuffer(iv) }, wrappingKey, arrayBuffer(this.mek)));
        const body = `${this.meetingCode}|${targetPeerId}|${toBase64(capsule.ciphertext)}|${toBase64(iv)}|${toBase64(encryptedKey)}`;
        const signature = await this.pqc.sign(encoder.encode(body));
        return { targetPeerId, ciphertext: toBase64(capsule.ciphertext), iv: toBase64(iv), encryptedKey: toBase64(encryptedKey), signature: toBase64(signature.signature) };
    }

    async acceptMeetingKey(envelope: E2EEKeyEnvelope, hostPeerId: string, hostSigningPublicKey: string, ownPeerId: string): Promise<void> {
        if (envelope.targetPeerId !== ownPeerId) throw new Error('Meeting key is addressed to another participant');
        const body = `${this.meetingCode}|${ownPeerId}|${envelope.ciphertext}|${envelope.iv}|${envelope.encryptedKey}`;
        const valid = await this.pqc.verify(encoder.encode(body), signatureRecord(envelope.signature), fromBase64(hostSigningPublicKey));
        if (!valid) throw new Error(`Meeting key signature from ${hostPeerId} is invalid`);
        const shared = await this.pqc.decapsulate(fromBase64(envelope.ciphertext));
        const wrappingKey = await crypto.subtle.importKey('raw', arrayBuffer(shared), 'AES-GCM', false, ['decrypt']);
        const mek = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: arrayBuffer(fromBase64(envelope.iv)) }, wrappingKey, arrayBuffer(fromBase64(envelope.encryptedKey)));
        this.mek = new Uint8Array(mek);
        this.activate();
    }

    async waitUntilActive(timeoutMs = 15_000): Promise<void> {
        if (this.active) return;
        await Promise.race([
            this.ready,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Waiting for the host to establish end-to-end encryption timed out')), timeoutMs)),
        ]);
    }

    rekey(): void {
        if (!this.active) throw new Error('Meeting encryption is not ready');
        this.mek?.fill(0);
        this.mek = crypto.getRandomValues(new Uint8Array(32));
        this.epochKeys.clear();
    }

    private activate(): void { this.active = true; this.resolveReady(); }

    private async keyFor(epoch: number, prefix: Uint8Array): Promise<CryptoKey> {
        if (!this.mek) throw new Error('Meeting encryption key is not established');
        const cacheKey = `${epoch}:${toBase64(prefix)}`;
        const cached = this.epochKeys.get(cacheKey);
        if (cached) return cached;
        const material = await crypto.subtle.importKey('raw', arrayBuffer(this.mek), 'HKDF', false, ['deriveKey']);
        const info = new Uint8Array(4 + prefix.length);
        new DataView(info.buffer).setUint32(0, epoch, false);
        info.set(prefix, 4);
        const key = await crypto.subtle.deriveKey(
            { name: 'HKDF', hash: 'SHA-256', salt: arrayBuffer(encoder.encode(`QS-VC-SFrame:${this.meetingCode}`)), info: arrayBuffer(info) },
            material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
        );
        this.epochKeys.set(cacheKey, key);
        for (const entry of this.epochKeys.keys()) if (Number(entry.split(':', 1)[0]) < epoch - 1) this.epochKeys.delete(entry);
        return key;
    }

    /**
     * Encrypt every outgoing frame. Must be called synchronously right after the sender exists:
     * Chrome rejects createEncodedStreams once media has started ("Too late to create encoded streams").
     * Frames are dropped until the meeting key is known, so nothing is ever sent in the clear.
     *
     * Frame layout: [codec header in clear][16-byte E2EE header][AES-GCM ciphertext][1 byte: clear length].
     * The first few codec bytes stay readable (as in Jitsi/SFrame) so the SFU can still spot VP8 key
     * frames and switch simulcast layers; they are authenticated as additional data.
     */
    setupSenderTransform(sender: RTCRtpSender): void {
        const streams = (sender as RTCRtpSender & { createEncodedStreams?: () => EncodedStreams }).createEncodedStreams?.();
        if (!streams) throw new Error('This browser does not support encoded media transforms required for end-to-end encryption');
        const transform = new TransformStream<EncodedFrame, EncodedFrame>({ transform: async (frame, controller) => {
            if (!this.active || !this.mek) return;
            const epoch = Math.floor(Date.now() / KEY_ROTATION_MS);
            if (this.frameEpoch !== epoch) { this.frameEpoch = epoch; this.frameCounter = 0; }
            if (this.frameCounter >= 0xffff_fffe) return;
            const counter = ++this.frameCounter;
            const data = new Uint8Array(frame.data);
            const clearBytes = Math.min(clearPrefixLength(frame), data.length);
            const header = new Uint8Array(HEADER_BYTES);
            const view = new DataView(header.buffer);
            view.setUint32(0, epoch, false); header.set(this.senderPrefix, 4); view.setUint32(12, counter, false);
            const iv = header.slice(4, 16);
            const clear = data.subarray(0, clearBytes);
            const aad = new Uint8Array(clearBytes + HEADER_BYTES); aad.set(clear); aad.set(header, clearBytes);
            try {
                const key = await this.keyFor(epoch, this.senderPrefix);
                const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: arrayBuffer(iv), additionalData: arrayBuffer(aad) }, key, arrayBuffer(data.subarray(clearBytes))));
                const out = new Uint8Array(clearBytes + HEADER_BYTES + encrypted.length + 1);
                out.set(clear); out.set(header, clearBytes); out.set(encrypted, clearBytes + HEADER_BYTES); out[out.length - 1] = clearBytes;
                frame.data = out.buffer;
                controller.enqueue(frame);
            } catch { /* drop the frame rather than send it unencrypted */ }
        } });
        void streams.readable.pipeThrough(transform).pipeTo(streams.writable).catch(() => undefined);
    }

    /** Decrypt every incoming frame. Same timing rule as setupSenderTransform. */
    setupReceiverTransform(receiver: RTCRtpReceiver): void {
        const streams = (receiver as RTCRtpReceiver & { createEncodedStreams?: () => EncodedStreams }).createEncodedStreams?.();
        if (!streams) throw new Error('This browser does not support encoded media transforms required for end-to-end encryption');
        const transform = new TransformStream<EncodedFrame, EncodedFrame>({ transform: async (frame, controller) => {
            if (!this.active || !this.mek) return;
            const data = new Uint8Array(frame.data);
            if (data.length < HEADER_BYTES + 17) return;
            const clearBytes = data[data.length - 1];
            if (clearBytes > MAX_CLEAR_BYTES || data.length < clearBytes + HEADER_BYTES + 17) return;
            const header = data.slice(clearBytes, clearBytes + HEADER_BYTES), view = new DataView(header.buffer);
            const epoch = view.getUint32(0, false), prefix = header.slice(4, 12);
            const iv = header.slice(4, 16);
            const aad = data.slice(0, clearBytes + HEADER_BYTES);
            try {
                const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: arrayBuffer(iv), additionalData: arrayBuffer(aad) }, await this.keyFor(epoch, prefix), arrayBuffer(data.subarray(clearBytes + HEADER_BYTES, data.length - 1))));
                const out = new Uint8Array(clearBytes + plain.length); out.set(data.subarray(0, clearBytes)); out.set(plain, clearBytes);
                frame.data = out.buffer;
                controller.enqueue(frame);
            } catch { /* Never pass undeciphered media to the renderer. */ }
        } });
        void streams.readable.pipeThrough(transform).pipeTo(streams.writable).catch(() => undefined);
    }

    isActive(): boolean { return this.active; }
    getCurrentEpoch(): number { return Math.floor(Date.now() / KEY_ROTATION_MS); }

    destroy(): void {
        this.active = false;
        this.epochKeys.clear();
        this.mek?.fill(0);
        this.mek = null;
    }
}
