/**
 * Active speaker detection using audio level analysis.
 * Uses Web Audio API to detect which participant is speaking.
 */

export class ActiveSpeakerDetector {
    private audioContexts: Map<string, { ctx: AudioContext; analyser: AnalyserNode; source: MediaStreamAudioSourceNode }> = new Map();
    private activeSpeaker: string | null = null;
    private intervalId: ReturnType<typeof setInterval> | null = null;
    private onActiveSpeakerChange: (peerId: string | null) => void;
    private threshold: number;

    constructor(
        onActiveSpeakerChange: (peerId: string | null) => void,
        threshold: number = 30 // volume threshold (0-255)
    ) {
        this.onActiveSpeakerChange = onActiveSpeakerChange;
        this.threshold = threshold;
    }

    /** Start monitoring a peer's audio stream. */
    addStream(peerId: string, stream: MediaStream): void {
        const audioTrack = stream.getAudioTracks()[0];
        if (!audioTrack) return;

        // Clean up existing
        this.removeStream(peerId);

        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.8;
        source.connect(analyser);

        this.audioContexts.set(peerId, { ctx, analyser, source });

        // Start polling if not already running
        if (!this.intervalId) {
            this.startPolling();
        }
    }

    /** Stop monitoring a peer's audio stream. */
    removeStream(peerId: string): void {
        const entry = this.audioContexts.get(peerId);
        if (entry) {
            entry.source.disconnect();
            entry.ctx.close().catch(() => { });
            this.audioContexts.delete(peerId);
        }

        if (this.activeSpeaker === peerId) {
            this.activeSpeaker = null;
            this.onActiveSpeakerChange(null);
        }

        if (this.audioContexts.size === 0 && this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    /** Poll audio levels and detect active speaker. */
    private startPolling(): void {
        this.intervalId = setInterval(() => {
            let loudestPeer: string | null = null;
            let loudestVolume = 0;

            for (const [peerId, { analyser }] of this.audioContexts) {
                const dataArray = new Uint8Array(analyser.frequencyBinCount);
                analyser.getByteFrequencyData(dataArray);

                // Calculate average volume
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    sum += dataArray[i];
                }
                const avg = sum / dataArray.length;

                if (avg > this.threshold && avg > loudestVolume) {
                    loudestVolume = avg;
                    loudestPeer = peerId;
                }
            }

            if (loudestPeer !== this.activeSpeaker) {
                this.activeSpeaker = loudestPeer;
                this.onActiveSpeakerChange(loudestPeer);
            }
        }, 200); // 5 times per second
    }

    /** Clean up all resources. */
    destroy(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        for (const [, entry] of this.audioContexts) {
            entry.source.disconnect();
            entry.ctx.close().catch(() => { });
        }
        this.audioContexts.clear();
    }

    /** Get current active speaker ID. */
    getActiveSpeaker(): string | null {
        return this.activeSpeaker;
    }
}
