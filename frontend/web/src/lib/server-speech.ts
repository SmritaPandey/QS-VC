/**
 * Server speech recognition: streams the meeting's OWN microphone track (the device picked in
 * the meeting, after noise suppression) as 16 kHz mono PCM to QS-VC signaling, which relays it
 * to the organisation's speech service. Works in every browser with AudioWorklet (Chrome, Edge,
 * Firefox, Safari, Electron). A separate consented audio copy is readable by signaling and ASR.
 */
import { signaling } from './signaling';

import { TARGET_RATE, floatToPcm16Base64, resampleTo16k } from './pcm';
export { TARGET_RATE, floatToPcm16Base64, resampleTo16k };
const CHUNK_SAMPLES = 4_000; // 250 ms

const WORKLET = `class QsvcCapture extends AudioWorkletProcessor {
  process(inputs) { const channel = inputs[0] && inputs[0][0]; if (channel && channel.length) this.port.postMessage(channel.slice(0)); return true; }
}
registerProcessor('qsvc-capture', QsvcCapture);`;

export interface ServerSpeechOptions {
    processorConsent: boolean;
    language: string; // BCP-47 or 'auto'
    getTrack: () => MediaStreamTrack | null;
    onError?: (message: string) => void;
}

export class ServerSpeechEngine {
    private context: AudioContext | null = null;
    private node: AudioWorkletNode | null = null;
    private source: MediaStreamAudioSourceNode | null = null;
    private track: MediaStreamTrack | null = null;
    private pending: Float32Array[] = [];
    private pendingLength = 0;
    private seq = 0;
    private active = false;
    private unsubscribe: Array<() => void> = [];

    constructor(private options: ServerSpeechOptions) {}

    static isSupported(): boolean {
        return typeof window !== 'undefined' && typeof AudioContext !== 'undefined' && typeof AudioWorkletNode !== 'undefined';
    }

    async start(): Promise<void> {
        if (this.active) return;
        if (!this.options.processorConsent) {
            this.options.onError?.('Allow transcription processor access before sharing microphone audio.');
            return;
        }
        const live = this.options.getTrack();
        if (!live || live.readyState !== 'live') { this.options.onError?.('No microphone is available for captions.'); return; }
        this.active = true;
        try {
            await signaling.request('asrStart', { language: this.options.language, processorConsent: true });
            if (!this.active) { signaling.notify('asrStop'); return; }
            // Clone so captions never change the track the meeting sends.
            this.track = live.clone();
            let context: AudioContext;
            try { context = new AudioContext({ sampleRate: TARGET_RATE }); } catch { context = new AudioContext(); }
            this.context = context;
            const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
            try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
            if (!this.active) return;
            this.source = context.createMediaStreamSource(new MediaStream([this.track]));
            this.node = new AudioWorkletNode(context, 'qsvc-capture');
            this.node.port.onmessage = (event: MessageEvent<Float32Array>) => this.collect(event.data, context.sampleRate);
            this.source.connect(this.node);
            // Keep the graph pulled without playing anything.
            const silent = context.createGain(); silent.gain.value = 0; this.node.connect(silent).connect(context.destination);
            if (context.state === 'suspended') await context.resume().catch(() => {});
            this.unsubscribe.push(
                signaling.on('asrStopped', () => { if (this.active) { this.stop(); this.options.onError?.('Speech recognition stopped. Turn captions on again to retry.'); } }),
                signaling.on('asrError', () => { if (this.active) { this.stop(); this.options.onError?.('Speech recognition stopped. Turn captions on again to retry.'); } }),
            );
        } catch {
            this.stop();
            this.options.onError?.('Speech recognition is unavailable. Turn captions on again to retry.');
        }
    }

    private collect(samples: Float32Array, rate: number) {
        if (!this.active || !this.track?.enabled) return;
        const resampled = resampleTo16k(samples, rate);
        this.pending.push(resampled); this.pendingLength += resampled.length;
        if (this.pendingLength < CHUNK_SAMPLES) return;
        const chunk = new Float32Array(this.pendingLength);
        let offset = 0;
        for (const part of this.pending) { chunk.set(part, offset); offset += part.length; }
        this.pending = []; this.pendingLength = 0;
        signaling.notify('asrAudio', { seq: ++this.seq, pcm: floatToPcm16Base64(chunk) });
    }

    /** Mirror mute: a disabled clone sends nothing. */
    setEnabled(enabled: boolean) { if (this.track) this.track.enabled = enabled; }

    stop(): void {
        const wasActive = this.active;
        this.active = false;
        this.unsubscribe.splice(0).forEach(off => off());
        try { this.source?.disconnect(); this.node?.disconnect(); } catch { /* already disconnected */ }
        this.node?.port.close();
        this.track?.stop();
        void this.context?.close().catch(() => {});
        this.context = null; this.node = null; this.source = null; this.track = null;
        this.pending = []; this.pendingLength = 0;
        if (wasActive) signaling.request('asrStop').catch(() => {});
    }

    isActive() { return this.active; }
}
