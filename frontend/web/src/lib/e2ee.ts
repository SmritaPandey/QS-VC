import { PQCManager, PQC_ALGORITHMS, type PQCSignature } from '../../../../shared/crypto/pqc';
import { clearPrefixLength, FrameCrypto, KEY_ROTATION_MS } from './e2ee-frame';

/**
 * End-to-end media encryption for QS-VC meetings.
 *
 * Key management (post-quantum):
 * - Every participant creates an ML-KEM-1024 (FIPS 203) key pair and an ML-DSA-87 (FIPS 204) signing
 *   key pair, and publishes a self-signed bundle bound to the meeting code and its server peer ID.
 * - One participant at a time is the meeting's key holder (the server elects it: normally the first
 *   to join, re-elected when it leaves). The holder generates a random 256-bit group key and sends it
 *   to each participant: ML-KEM encapsulation → SP 800-108 Counter/HMAC-SHA-256 wrapping key →
 *   AES-256-GCM, with the whole envelope signed by the holder's ML-DSA-87 key.
 * - The holder rotates the group key whenever someone leaves, so a departed participant cannot
 *   decrypt later media. A newly elected holder always rotates before distributing.
 *
 * Media (see e2ee-frame.ts): AES-256-GCM per frame with sender-unique derived keys and nonces.
 * Chrome/Edge use encoded streams on the main thread; Safari and Firefox use RTCRtpScriptTransform.
 */

const encoder = new TextEncoder();
const arrayBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

export interface E2EEKeyBundle {
    peerId: string;
    kemPublicKey: string;
    signingPublicKey: string;
    signature: string;
}

export interface E2EEKeyEnvelope {
    senderPeerId: string;
    targetPeerId: string;
    keyId: number;
    ciphertext: string;
    iv: string;
    encryptedKey: string;
    signature: string;
}

const toBase64 = (bytes: Uint8Array) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const fromBase64 = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const signatureRecord = (signature: string): PQCSignature => ({
    algorithm: PQC_ALGORITHMS.SIG_ML_DSA_87, signature: fromBase64(signature), publicKey: new Uint8Array(), timestamp: 0,
});

type EncodedFrame = RTCEncodedVideoFrame | RTCEncodedAudioFrame;
type EncodedStreams = { readable: ReadableStream<EncodedFrame>; writable: WritableStream<EncodedFrame> };
type ScriptTransformCtor = new (worker: Worker, options?: unknown) => unknown;
const scriptTransformCtor = (): ScriptTransformCtor | undefined => (globalThis as { RTCRtpScriptTransform?: ScriptTransformCtor }).RTCRtpScriptTransform;

/** Chrome/Edge: encoded streams on the main thread (requires the encodedInsertableStreams flag). */
export function encodedStreamsSupported(): boolean {
    return typeof RTCRtpSender !== 'undefined' && 'createEncodedStreams' in RTCRtpSender.prototype;
}

/** Safari 15.4+, Firefox 117+ and newer Chrome: transforms in a dedicated worker. */
export function scriptTransformSupported(): boolean {
    return !!scriptTransformCtor() && typeof Worker !== 'undefined';
}

/** True when this browser can take part in an end-to-end encrypted meeting. */
export function encodedTransformsSupported(): boolean {
    return encodedStreamsSupported() || scriptTransformSupported();
}

const ENVELOPE_LABEL = 'QS-VC-MEK:v2';

export class E2EEManager {
    private readonly pqc = new PQCManager();
    private readonly prefix = crypto.getRandomValues(new Uint8Array(8));
    private readonly mode: 'streams' | 'script' | 'none';
    private frames: FrameCrypto | null = null;
    private worker: Worker | null = null;
    private mek: Uint8Array | null = null;
    private keyId = -1;
    private peerId = '';
    private resolveReady!: () => void;
    private readonly ready = new Promise<void>(resolve => { this.resolveReady = resolve; });
    private active = false;
    private readonly keyListeners = new Set<() => void>();
    private senderFramesSeen = 0;

    constructor(private readonly meetingCode: string) {
        // Development-only switch to exercise the Safari/Firefox (worker) path in Chrome.
        const forceScript = import.meta.env?.DEV && (globalThis as { __QSVC_E2EE_FORCE_SCRIPT?: boolean }).__QSVC_E2EE_FORCE_SCRIPT === true && scriptTransformSupported();
        this.mode = forceScript ? 'script' : encodedStreamsSupported() ? 'streams' : scriptTransformSupported() ? 'script' : 'none';
    }

    /** 'none' = no media transform API (key management still works; media setup will refuse). */
    getMode(): 'streams' | 'script' | 'none' { return this.mode; }

    /** Create this participant's ML-KEM-1024 / ML-DSA-87 identity and the signed bundle to publish. */
    async init(peerId: string): Promise<E2EEKeyBundle> {
        this.peerId = peerId;
        await this.pqc.init();
        if (this.mode !== 'script') this.frames = new FrameCrypto(this.meetingCode, peerId, this.prefix.slice());
        else {
            this.worker = new Worker(new URL('./e2ee-worker.ts', import.meta.url), { type: 'module', name: 'qsvc-e2ee' });
            this.worker.onerror = event => console.error('[E2EE] Encryption worker failed:', event.message || event);
            this.worker.onmessage = event => { if (event.data?.type === 'stats' && typeof event.data.senderFramesSeen === 'number') this.senderFramesSeen = event.data.senderFramesSeen; };
            this.worker.postMessage({ type: 'init', meetingCode: this.meetingCode, peerId, prefix: this.prefix.slice() });
        }
        const kemPublicKey = toBase64(this.pqc.getPublicKey());
        const signingPublicKey = toBase64(this.pqc.getSigningPublicKey());
        const signature = await this.pqc.sign(encoder.encode(`${this.meetingCode}|${peerId}|${kemPublicKey}|${signingPublicKey}`));
        return { peerId, kemPublicKey, signingPublicKey, signature: toBase64(signature.signature) };
    }

    /** Older call sites. A "host" here just means the first key holder. */
    async initAsParticipant(peerId: string): Promise<E2EEKeyBundle> { return this.init(peerId); }
    async initAsHost(peerId: string): Promise<E2EEKeyBundle> { const bundle = await this.init(peerId); this.generateGroupKey(); return bundle; }

    async verifyKeyBundle(bundle: E2EEKeyBundle, expectedPeerId: string): Promise<boolean> {
        try {
            if (!bundle || bundle.peerId !== expectedPeerId) return false;
            return await this.pqc.verify(
                encoder.encode(`${this.meetingCode}|${bundle.peerId}|${bundle.kemPublicKey}|${bundle.signingPublicKey}`),
                signatureRecord(bundle.signature), fromBase64(bundle.signingPublicKey),
            );
        } catch { return false; }
    }

    /** Key holder only: create a fresh group key (first key or a rotation). Returns its key id. */
    generateGroupKey(): number {
        const next = this.keyId < 0 ? crypto.getRandomValues(new Uint8Array(1))[0] : (this.keyId + 1) % 256;
        this.install(next, crypto.getRandomValues(new Uint8Array(32)));
        return next;
    }

    /** Rotate the group key (the holder does this whenever someone leaves). */
    rekey(): number { return this.generateGroupKey(); }

    private install(keyId: number, mek: Uint8Array): void {
        this.mek?.fill(0);
        this.mek = mek.slice();
        this.keyId = keyId;
        if (this.frames) this.frames.setKey(keyId, mek);
        if (this.worker) this.worker.postMessage({ type: 'key', keyId, mek: mek.slice() });
        mek.fill(0);
        this.active = true;
        this.resolveReady();
        for (const listener of this.keyListeners) listener();
    }

    onKeyChange(listener: () => void): () => void { this.keyListeners.add(listener); return () => { this.keyListeners.delete(listener); }; }

    async wrapMeetingKeyForPeer(targetPeerId: string, kemPublicKey: string): Promise<E2EEKeyEnvelope> {
        if (!this.mek || !this.active || !this.peerId) throw new Error('Meeting encryption is not ready');
        const keyId = this.keyId;
        const mek = this.mek.slice();
        try {
            const context = encoder.encode(`QS-VC-MEK-KDF:v2|${this.meetingCode}|${this.peerId}|${targetPeerId}|${keyId}`);
            const capsule = await this.pqc.encapsulateForPeer(fromBase64(kemPublicKey), context);
            let wrappingKey: CryptoKey;
            try { wrappingKey = await crypto.subtle.importKey('raw', arrayBuffer(capsule.combinedSecret), 'AES-GCM', false, ['encrypt']); }
            finally { capsule.combinedSecret.fill(0); }
            const ciphertext = toBase64(capsule.ciphertext);
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const associatedData = encoder.encode(`${ENVELOPE_LABEL}|${this.meetingCode}|${this.peerId}|${targetPeerId}|${keyId}|${ciphertext}`);
            const encryptedKey = toBase64(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: arrayBuffer(iv), additionalData: arrayBuffer(associatedData) }, wrappingKey, arrayBuffer(mek))));
            const ivText = toBase64(iv);
            const body = `${ENVELOPE_LABEL}|${this.meetingCode}|${this.peerId}|${targetPeerId}|${keyId}|${ciphertext}|${ivText}|${encryptedKey}`;
            const signature = await this.pqc.sign(encoder.encode(body));
            return { senderPeerId: this.peerId, targetPeerId, keyId, ciphertext, iv: ivText, encryptedKey, signature: toBase64(signature.signature) };
        } finally { mek.fill(0); }
    }

    /** Accept a group key from the current key holder after checking its ML-DSA-87 signature. */
    async acceptMeetingKey(envelope: E2EEKeyEnvelope, holderPeerId: string, holderSigningPublicKey: string, ownPeerId: string): Promise<void> {
        if (!envelope || envelope.senderPeerId !== holderPeerId || envelope.targetPeerId !== ownPeerId) throw new Error('Meeting key sender or recipient does not match this session');
        if (!Number.isInteger(envelope.keyId) || envelope.keyId < 0 || envelope.keyId > 255) throw new Error('Invalid meeting key id');
        const { keyId, ciphertext, iv, encryptedKey } = envelope;
        const body = `${ENVELOPE_LABEL}|${this.meetingCode}|${holderPeerId}|${ownPeerId}|${keyId}|${ciphertext}|${iv}|${encryptedKey}`;
        const valid = await this.pqc.verify(encoder.encode(body), signatureRecord(envelope.signature), fromBase64(holderSigningPublicKey));
        if (!valid) throw new Error(`Meeting key signature from ${holderPeerId} is invalid`);
        const context = encoder.encode(`QS-VC-MEK-KDF:v2|${this.meetingCode}|${holderPeerId}|${ownPeerId}|${keyId}`);
        const shared = await this.pqc.decapsulate(fromBase64(ciphertext), context);
        let wrappingKey: CryptoKey;
        try { wrappingKey = await crypto.subtle.importKey('raw', arrayBuffer(shared), 'AES-GCM', false, ['decrypt']); }
        finally { shared.fill(0); }
        const associatedData = encoder.encode(`${ENVELOPE_LABEL}|${this.meetingCode}|${holderPeerId}|${ownPeerId}|${keyId}|${ciphertext}`);
        const mek = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: arrayBuffer(fromBase64(iv)), additionalData: arrayBuffer(associatedData) }, wrappingKey, arrayBuffer(fromBase64(encryptedKey))));
        if (mek.length !== 32) throw new Error('Invalid meeting key length');
        this.install(keyId, mek);
    }

    async waitUntilActive(timeoutMs = 15_000): Promise<void> {
        if (this.active) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                this.ready,
                new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Waiting for the meeting encryption key timed out')), timeoutMs); }),
            ]);
        } finally { if (timer) clearTimeout(timer); }
    }

    /**
     * Encrypt everything this sender sends. Call synchronously right after the producer exists:
     * Chrome rejects a late createEncodedStreams(). Until a group key is installed every frame is
     * dropped, so media never leaves the device unencrypted.
     */
    setupSenderTransform(sender: RTCRtpSender, kind: 'audio' | 'video' = (sender.track?.kind as 'audio' | 'video') || 'audio'): void {
        if (this.mode === 'script') {
            const Transform = scriptTransformCtor();
            if (!this.worker || !Transform) throw new Error('Media encryption is not initialised');
            (sender as unknown as { transform: unknown }).transform = new Transform(this.worker, { operation: 'encrypt', kind });
            return;
        }
        const frames = this.mode === 'streams' ? this.frames : null;
        const streams = (sender as RTCRtpSender & { createEncodedStreams?: () => EncodedStreams }).createEncodedStreams?.();
        if (!streams || !frames) throw new Error('This browser does not support encoded media transforms required for end-to-end encryption');
        const isVideo = kind === 'video';
        const transform = new TransformStream<EncodedFrame, EncodedFrame>({ transform: async (frame, controller) => {
            this.senderFramesSeen++;
            const out = await frames.encrypt(frame.data, clearPrefixLength(frame as { type?: string; data: ArrayBuffer }, isVideo)).catch(() => null);
            if (!out) return;
            frame.data = out;
            controller.enqueue(frame);
        } });
        void streams.readable.pipeThrough(transform).pipeTo(streams.writable).catch(() => undefined);
    }

    /** Decrypt everything received from senderPeerId on this receiver. Same timing rule as senders. */
    setupReceiverTransform(receiver: RTCRtpReceiver, senderPeerId: string, kind: 'audio' | 'video' = (receiver.track?.kind as 'audio' | 'video') || 'audio', streamTag = ''): void {
        if (!senderPeerId) throw new Error('The encrypted media sender identity is missing');
        if (this.mode === 'script') {
            const Transform = scriptTransformCtor();
            if (!this.worker || !Transform) throw new Error('Media encryption is not initialised');
            (receiver as unknown as { transform: unknown }).transform = new Transform(this.worker, { operation: 'decrypt', kind, senderPeerId, streamTag });
            return;
        }
        const frames = this.mode === 'streams' ? this.frames : null;
        const streams = (receiver as RTCRtpReceiver & { createEncodedStreams?: () => EncodedStreams }).createEncodedStreams?.();
        if (!streams || !frames) throw new Error('This browser does not support encoded media transforms required for end-to-end encryption');
        const transform = new TransformStream<EncodedFrame, EncodedFrame>({ transform: async (frame, controller) => {
            const out = await frames.decrypt(frame.data, senderPeerId, streamTag).catch(() => null);
            if (!out) return; // never pass undeciphered media to the renderer
            frame.data = out;
            controller.enqueue(frame);
        } });
        void streams.readable.pipeThrough(transform).pipeTo(streams.writable).catch(() => undefined);
    }

    /**
     * Outgoing frames that actually passed through the encryptor. If a browser accepted the transform
     * but routed media around it, this stays at 0 while we publish — the caller then stops sending
     * (fail closed) instead of risking unencrypted media.
     */
    getSenderFramesSeen(): number { return this.senderFramesSeen; }

    isActive(): boolean { return this.active; }
    getKeyId(): number { return this.keyId; }
    getCurrentEpoch(): number { return Math.floor(Date.now() / KEY_ROTATION_MS); }

    destroy(): void {
        this.active = false;
        this.mek?.fill(0);
        this.mek = null;
        this.frames?.destroy();
        this.frames = null;
        if (this.worker) { this.worker.postMessage({ type: 'destroy' }); this.worker.terminate(); this.worker = null; }
        this.prefix.fill(0);
        this.keyListeners.clear();
        this.pqc.destroy();
    }
}
