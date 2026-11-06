/// <reference lib="webworker" />
/**
 * RTCRtpScriptTransform worker (Safari, Firefox, newer Chrome). The page posts the group key here;
 * the browser hands each sender/receiver's encoded stream to this worker through `rtctransform`.
 */
import { clearPrefixLength, FrameCrypto } from './e2ee-frame';

type Init = { type: 'init'; meetingCode: string; peerId: string; prefix: Uint8Array };
type SetKey = { type: 'key'; keyId: number; mek: Uint8Array };
type Destroy = { type: 'destroy' };
type TransformOptions = { operation: 'encrypt' | 'decrypt'; kind: 'audio' | 'video'; senderPeerId?: string; streamTag?: string };

interface RTCTransformEvent extends Event {
    transformer: { readable: ReadableStream<any>; writable: WritableStream<any>; options: TransformOptions };
}

let frames: FrameCrypto | null = null;
/** Outgoing frames this worker has seen; the page uses it to prove media really passes the encryptor. */
let senderFramesSeen = 0;
let reported = -1;
const report = setInterval(() => {
    if (senderFramesSeen !== reported) { reported = senderFramesSeen; (self as DedicatedWorkerGlobalScope).postMessage({ type: 'stats', senderFramesSeen }); }
}, 1000);

self.onmessage = (event: MessageEvent<Init | SetKey | Destroy>) => {
    const message = event.data;
    if (message.type === 'init') frames = new FrameCrypto(message.meetingCode, message.peerId, new Uint8Array(message.prefix));
    else if (message.type === 'key') { const mek = new Uint8Array(message.mek); frames?.setKey(message.keyId, mek); mek.fill(0); }
    else if (message.type === 'destroy') { frames?.destroy(); frames = null; clearInterval(report); }
};

self.addEventListener('rtctransform', (event: Event) => {
    const { readable, writable, options } = (event as RTCTransformEvent).transformer;
    const isVideo = options.kind === 'video';
    const transform = new TransformStream({
        async transform(frame: any, controller) {
            if (options.operation === 'encrypt') senderFramesSeen++;
            if (!frames) return;
            const out = options.operation === 'encrypt'
                ? await frames.encrypt(frame.data, clearPrefixLength(frame, isVideo)).catch(() => null)
                : await frames.decrypt(frame.data, options.senderPeerId || '', options.streamTag || '').catch(() => null);
            if (!out) return; // never forward a frame that is not encrypted/authentic
            frame.data = out;
            controller.enqueue(frame);
        },
    });
    readable.pipeThrough(transform).pipeTo(writable).catch(() => undefined);
});
