import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletPath from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

/** RNNoise processor whose output track replaces the raw microphone track sent to the SFU. */
export class NoiseSuppressor {
    private audioContext: AudioContext | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private destinationNode: MediaStreamAudioDestinationNode | null = null;
    private workletNode: RnnoiseWorkletNode | null = null;
    private processedStream: MediaStream | null = null;

    async start(sourceStream: MediaStream): Promise<MediaStream> {
        const audioTrack = sourceStream.getAudioTracks()[0];
        if (!audioTrack) throw new Error('No microphone track is available.');
        if (!('audioWorklet' in AudioContext.prototype)) throw new Error('AI noise suppression is not supported by this browser.');

        const context = new AudioContext({ sampleRate: 48000 });
        this.audioContext = context;
        try {
            if (context.sampleRate !== 48000) throw new Error('AI noise suppression needs 48 kHz audio, which this device does not provide.');
            const [wasmBinary] = await Promise.all([
                loadRnnoise({ url: rnnoiseWasmPath, simdUrl: rnnoiseSimdWasmPath }),
                context.audioWorklet.addModule(rnnoiseWorkletPath),
            ]);
            if (context.state === 'suspended') await context.resume();

            const source = context.createMediaStreamSource(new MediaStream([audioTrack]));
            const destination = context.createMediaStreamDestination();
            const worklet = new RnnoiseWorkletNode(context, { wasmBinary, maxChannels: 1 });
            source.connect(worklet);
            worklet.connect(destination);

            this.sourceNode = source;
            this.destinationNode = destination;
            this.workletNode = worklet;
            this.processedStream = destination.stream;
            return destination.stream;
        } catch (error) {
            this.stop();
            throw error;
        }
    }

    stop(): void {
        this.sourceNode?.disconnect();
        this.sourceNode = null;
        this.workletNode?.disconnect();
        this.workletNode?.destroy();
        this.workletNode = null;
        this.destinationNode?.stream.getTracks().forEach(track => track.stop());
        this.destinationNode = null;
        this.processedStream = null;
        const context = this.audioContext;
        this.audioContext = null;
        if (context && context.state !== 'closed') void context.close().catch(() => {});
    }

    getStream(): MediaStream | null {
        return this.processedStream;
    }
}
