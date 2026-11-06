/**
 * Per-frame media encryption used by both the main thread (Chrome/Edge encoded streams) and the
 * RTCRtpScriptTransform worker (Safari, Firefox and newer Chrome). No DOM access: safe in a worker.
 *
 * Frame format v2 (trailer header so the codec's leading bytes can stay readable for the SFU):
 *
 *   [clear codec prefix: N bytes][AES-256-GCM ciphertext + 16-byte tag][header: 24 bytes]
 *
 *   header = magic "QSVC"(4) | version=2(1) | N(1) | keyId(1) | reserved=0(1)
 *            | epoch(4, BE) | sender prefix(8) | counter(4, BE)
 *
 * - N is 10 for a VP8 key frame, 3 for a VP8 delta frame, 0 for audio. Those bytes are the VP8
 *   payload header the SFU reads to find key frames and switch simulcast layers (the same split
 *   Jitsi uses). They are authenticated as additional data, never left unprotected against change.
 * - The AES-GCM nonce is prefix(8) || counter(4). The prefix is random per session, the counter is
 *   strictly increasing for one (keyId, epoch, prefix) and the derived key is unique to
 *   (group key, keyId, epoch, prefix, sender peer ID), so a nonce is never reused under one key.
 * - Frame keys are derived from the ML-KEM-distributed group key with SP 800-108 Counter/HMAC-SHA-256.
 * - keyId lets receivers keep the previous group key for a short grace period after a rekey, so
 *   frames already in flight still decrypt and audio does not drop out on every join or leave.
 */

export const FRAME_MAGIC = new Uint8Array([0x51, 0x53, 0x56, 0x43]); // QSVC
export const FRAME_VERSION = 2;
export const HEADER_BYTES = 24;
export const TAG_BYTES = 16;
export const MAX_CLEAR_BYTES = 10;
export const KEY_ROTATION_MS = 60_000;
const EPOCH_SKEW_TOLERANCE = 5;
const RETIRED_KEY_GRACE_MS = 10_000;
const REPLAY_WINDOW = 512; // one sender's audio and video share the counter, so allow interleaving
const encoder = new TextEncoder();
const buf = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

/** One-block SP 800-108 Rev. 1 Counter KDF with HMAC-SHA-256 (L = 256). Mirrors shared/crypto/pqc.ts. */
async function kdf(keyDerivationKey: Uint8Array, label: Uint8Array, context: Uint8Array): Promise<Uint8Array> {
    const hmacKey = await crypto.subtle.importKey('raw', buf(keyDerivationKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const input = new Uint8Array(4 + label.length + 1 + context.length + 4);
    const view = new DataView(input.buffer);
    view.setUint32(0, 1, false);
    input.set(label, 4);
    input[4 + label.length] = 0;
    input.set(context, 5 + label.length);
    view.setUint32(input.length - 4, 256, false);
    return new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, input));
}

/** Readable prefix length for a frame: VP8 payload header only. Audio and other frames: none. */
export function clearPrefixLength(frame: { type?: string; data: ArrayBuffer }, isVideo: boolean): number {
    if (!isVideo) return 0;
    if (frame.type === 'key') return Math.min(10, frame.data.byteLength);
    if (frame.type === 'delta') return Math.min(3, frame.data.byteLength);
    return 0;
}

interface GroupKey { mek: Uint8Array; retiredAt: number | null; derived: Map<string, CryptoKey>; }
interface ReplayWindow { highest: number; seen: Set<number>; pending: Set<number>; }

export class FrameCrypto {
    private readonly keys = new Map<number, GroupKey>();
    private currentKeyId: number | null = null;
    private readonly replay = new Map<string, ReplayWindow>();
    private counter = 0;
    private counterScope = '';

    constructor(private readonly meetingCode: string, private peerId: string, private readonly senderPrefix: Uint8Array = crypto.getRandomValues(new Uint8Array(8))) {
        if (senderPrefix.length !== 8) throw new Error('The sender prefix must be 8 bytes');
    }

    setPeerId(peerId: string): void { this.peerId = peerId; }
    hasKey(): boolean { return this.currentKeyId !== null; }
    getPrefix(): Uint8Array { return this.senderPrefix.slice(); }

    /** Install a group key. The previous key stays usable for decryption for a short grace period. */
    setKey(keyId: number, mek: Uint8Array): void {
        if (!Number.isInteger(keyId) || keyId < 0 || keyId > 255) throw new Error('Invalid key id');
        if (mek.length !== 32) throw new Error('The group key must be 256 bits');
        const now = Date.now();
        if (this.currentKeyId !== null && this.currentKeyId !== keyId) {
            const previous = this.keys.get(this.currentKeyId);
            if (previous) previous.retiredAt = now;
        }
        const existing = this.keys.get(keyId);
        if (existing) existing.mek.fill(0);
        this.keys.set(keyId, { mek: mek.slice(), retiredAt: null, derived: new Map() });
        this.currentKeyId = keyId;
        for (const key of [...this.replay.keys()]) if (key.startsWith(`${keyId}:`)) this.replay.delete(key);
        this.purge(now);
    }

    private purge(now = Date.now()): void {
        for (const [id, key] of this.keys) {
            if (key.retiredAt !== null && now - key.retiredAt > RETIRED_KEY_GRACE_MS) {
                key.mek.fill(0);
                this.keys.delete(id);
                for (const replayKey of [...this.replay.keys()]) if (replayKey.startsWith(`${id}:`)) this.replay.delete(replayKey);
            }
        }
    }

    private async frameKey(keyId: number, epoch: number, prefix: Uint8Array, senderPeerId: string): Promise<CryptoKey | null> {
        const group = this.keys.get(keyId);
        if (!group) return null;
        if (!senderPeerId || senderPeerId.length > 128) return null;
        const cacheKey = `${epoch}:${senderPeerId}:${Array.from(prefix).join('.')}`;
        const cached = group.derived.get(cacheKey);
        if (cached) return cached;
        const sender = encoder.encode(senderPeerId);
        const info = new Uint8Array(20 + sender.length);
        info.set(FRAME_MAGIC, 0);
        info[4] = FRAME_VERSION;
        info[5] = keyId;
        new DataView(info.buffer).setUint32(8, epoch, false);
        info.set(prefix, 12);
        info.set(sender, 20);
        const bytes = await kdf(group.mek, encoder.encode(`QS-VC-MEDIA-FRAME:v2:${this.meetingCode}`), info);
        try {
            const key = await crypto.subtle.importKey('raw', buf(bytes), 'AES-GCM', false, ['encrypt', 'decrypt']);
            group.derived.set(cacheKey, key);
            for (const entry of [...group.derived.keys()]) if (Number(entry.split(':', 1)[0]) < epoch - 1) group.derived.delete(entry);
            return key;
        } finally { bytes.fill(0); }
    }

    /** Encrypt one encoded frame. Returns null (drop the frame) when no key is installed yet. */
    async encrypt(data: ArrayBuffer, clearBytes: number): Promise<ArrayBuffer | null> {
        const keyId = this.currentKeyId;
        if (keyId === null || !this.peerId) return null;
        const plain = new Uint8Array(data);
        const clear = Math.max(0, Math.min(clearBytes, MAX_CLEAR_BYTES, plain.length));
        const epoch = Math.floor(Date.now() / KEY_ROTATION_MS);
        const scope = `${keyId}:${epoch}`;
        if (scope !== this.counterScope) { this.counterScope = scope; this.counter = 0; }
        if (this.counter >= 0xffff_fffe) return null; // never wrap the nonce counter
        const counter = ++this.counter;
        const header = new Uint8Array(HEADER_BYTES);
        const view = new DataView(header.buffer);
        header.set(FRAME_MAGIC, 0);
        header[4] = FRAME_VERSION; header[5] = clear; header[6] = keyId; header[7] = 0;
        view.setUint32(8, epoch, false);
        header.set(this.senderPrefix, 12);
        view.setUint32(20, counter, false);
        const key = await this.frameKey(keyId, epoch, this.senderPrefix, this.peerId);
        if (!key) return null;
        const aad = new Uint8Array(HEADER_BYTES + clear);
        aad.set(header); aad.set(plain.subarray(0, clear), HEADER_BYTES);
        const sealed = new Uint8Array(await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: buf(header.subarray(12, 24)), additionalData: buf(aad), tagLength: 128 },
            key, buf(plain.subarray(clear)),
        ));
        const out = new Uint8Array(clear + sealed.length + HEADER_BYTES);
        out.set(plain.subarray(0, clear), 0);
        out.set(sealed, clear);
        out.set(header, clear + sealed.length);
        return out.buffer;
    }

    /**
     * Decrypt one frame from senderPeerId. Returns null (drop) for anything not authentic or replayed.
     * streamTag separates replay windows per received track (a sender's tracks share one counter).
     */
    async decrypt(data: ArrayBuffer, senderPeerId: string, streamTag = ''): Promise<ArrayBuffer | null> {
        const bytes = new Uint8Array(data);
        if (bytes.length < HEADER_BYTES + TAG_BYTES) return null;
        const header = bytes.slice(bytes.length - HEADER_BYTES);
        if (!FRAME_MAGIC.every((value, index) => header[index] === value) || header[4] !== FRAME_VERSION || header[7] !== 0) return null;
        const clear = header[5], keyId = header[6];
        if (clear > MAX_CLEAR_BYTES || bytes.length < clear + TAG_BYTES + HEADER_BYTES) return null;
        const view = new DataView(header.buffer);
        const epoch = view.getUint32(8, false), prefix = header.slice(12, 20), counter = view.getUint32(20, false);
        const localEpoch = Math.floor(Date.now() / KEY_ROTATION_MS);
        if (epoch + EPOCH_SKEW_TOLERANCE < localEpoch || epoch > localEpoch + EPOCH_SKEW_TOLERANCE) return null;
        this.purge();
        const windowKey = `${keyId}:${epoch}:${Array.from(prefix).join('.')}:${senderPeerId}:${streamTag}`;
        if (!this.reserve(windowKey, counter)) return null;
        try {
            const key = await this.frameKey(keyId, epoch, prefix, senderPeerId);
            if (!key) { this.release(windowKey, counter); return null; }
            const aad = new Uint8Array(HEADER_BYTES + clear);
            aad.set(header); aad.set(bytes.subarray(0, clear), HEADER_BYTES);
            const plain = new Uint8Array(await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: buf(header.subarray(12, 24)), additionalData: buf(aad), tagLength: 128 },
                key, buf(bytes.subarray(clear, bytes.length - HEADER_BYTES)),
            ));
            this.remember(windowKey, counter);
            const out = new Uint8Array(clear + plain.length);
            out.set(bytes.subarray(0, clear), 0);
            out.set(plain, clear);
            return out.buffer;
        } catch {
            this.release(windowKey, counter);
            return null;
        }
    }

    /** Reserve synchronously before awaiting AES-GCM so two in-flight copies of one frame cannot both pass. */
    private reserve(windowKey: string, counter: number): boolean {
        if (counter <= 0) return false;
        const window = this.replay.get(windowKey) || { highest: 0, seen: new Set<number>(), pending: new Set<number>() };
        if (counter + REPLAY_WINDOW <= window.highest || window.seen.has(counter) || window.pending.has(counter) || window.pending.size >= 256) return false;
        window.pending.add(counter);
        this.replay.set(windowKey, window);
        return true;
    }

    private remember(windowKey: string, counter: number): void {
        const window = this.replay.get(windowKey);
        if (!window) return;
        window.pending.delete(counter);
        if (counter > window.highest) window.highest = counter;
        window.seen.add(counter);
        for (const value of window.seen) if (value + REPLAY_WINDOW <= window.highest) window.seen.delete(value);
        if (this.replay.size > 512) {
            const oldest = this.replay.keys().next().value;
            if (oldest !== undefined && oldest !== windowKey) this.replay.delete(oldest);
        }
    }

    private release(windowKey: string, counter: number): void {
        const window = this.replay.get(windowKey);
        if (!window) return;
        window.pending.delete(counter);
        if (window.highest === 0 && window.pending.size === 0 && window.seen.size === 0) this.replay.delete(windowKey);
    }

    destroy(): void {
        for (const key of this.keys.values()) key.mek.fill(0);
        this.keys.clear();
        this.replay.clear();
        this.currentKeyId = null;
        this.senderPrefix.fill(0);
    }
}
