/**
 * Noise suppression using RNNoise via AudioWorklet.
 * Wraps the RNNoise WASM module for real-time noise cancellation.
 *
 * In production: compile rnnoise.wasm and load via AudioWorklet.
 * This scaffold provides the integration API.
 */

export class NoiseSuppressor {
    private audioContext: AudioContext | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private destinationNode: MediaStreamAudioDestinationNode | null = null;
    private workletNode: AudioWorkletNode | null = null;
    private active: boolean = false;
    private processedStream: MediaStream | null = null;

    /** Initialize the noise suppressor with a source stream. */
    async start(sourceStream: MediaStream): Promise<MediaStream> {
        const audioTrack = sourceStream.getAudioTracks()[0];
        if (!audioTrack) throw new Error('No audio track in source stream');

        this.audioContext = new AudioContext({ sampleRate: 48000 });

        // Create source from input stream
        this.sourceNode = this.audioContext.createMediaStreamSource(sourceStream);

        // Create destination for processed output
        this.destinationNode = this.audioContext.createMediaStreamDestination();

        try {
            // Try to load RNNoise AudioWorklet (production path)
            await this.audioContext.audioWorklet.addModule('/rnnoise-processor.js');
            this.workletNode = new AudioWorkletNode(this.audioContext, 'rnnoise-processor');
            this.sourceNode.connect(this.workletNode);
            this.workletNode.connect(this.destinationNode);
        } catch {
            // Fallback: use a simple gain-based noise gate
            console.warn('RNNoise WASM not available, using noise gate fallback');
            const compressor = this.audioContext.createDynamicsCompressor();
            compressor.threshold.value = -50;
            compressor.knee.value = 40;
            compressor.ratio.value = 12;
            compressor.attack.value = 0;
            compressor.release.value = 0.25;

            this.sourceNode.connect(compressor);
            compressor.connect(this.destinationNode);
        }

        this.processedStream = this.destinationNode.stream;

        // Copy video tracks from source
        for (const videoTrack of sourceStream.getVideoTracks()) {
            this.processedStream.addTrack(videoTrack);
        }

        this.active = true;
        return this.processedStream;
    }

    /** Stop noise suppression. */
    stop(): void {
        this.active = false;
        this.sourceNode?.disconnect();
        this.workletNode?.disconnect();
        if (this.audioContext) {
            this.audioContext.close().catch(() => { });
            this.audioContext = null;
        }
        this.processedStream = null;
    }

    /** Check if noise suppression is active. */
    isActive(): boolean {
        return this.active;
    }

    /** Get the processed stream. */
    getStream(): MediaStream | null {
        return this.processedStream;
    }
}
