import { signaling } from './signaling';

/** Unlock audio from the Listen gesture and play finalized translations in arrival order. */
export class MeetingVoice {
    private readonly context = new AudioContext();
    private chain = Promise.resolve();
    private queued = 0;
    private stopped = false;
    private source?: AudioBufferSourceNode;

    unlock() { return this.context.resume(); }

    enqueue(id: string, target: string, speaking: (active: boolean) => void, failed: () => void) {
        if (this.stopped) return;
        if (this.queued >= 4) { failed(); return; }
        this.queued++;
        this.chain = this.chain.then(async () => {
            if (this.stopped) return;
            const { wav } = await signaling.request('captionVoice', { id, target });
            if (this.stopped) return;
            const bytes = Uint8Array.from(atob(wav), char => char.charCodeAt(0));
            const buffer = await this.context.decodeAudioData(bytes.buffer);
            if (this.stopped) return;
            if (this.context.state !== 'running') throw new Error('Audio playback paused');
            const source = this.context.createBufferSource();
            this.source = source;
            source.buffer = buffer;
            source.connect(this.context.destination);
            await new Promise<void>(resolve => {
                source.onended = () => { source.disconnect(); resolve(); };
                source.start();
                speaking(true);
            });
        }).catch(() => { if (!this.stopped) failed(); }).finally(() => {
            this.queued--;
            if (!this.stopped) speaking(false);
        });
    }

    stop() {
        this.stopped = true;
        this.source?.stop();
        void this.context.close().catch(() => {});
    }
}
