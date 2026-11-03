/** A quiet noise floor and short release prevent flicker between syllables. */
export function createVoiceLevel() {
    let lastSound = -Infinity;
    return (rms: number, now: number): number => {
        if (Number.isFinite(rms) && rms >= 0.02) {
            lastSound = now;
            return Math.min(1, rms / 0.12);
        }
        return now - lastSound < 220 ? 0.12 : 0;
    };
}

let sharedContext: AudioContext | null = null;
let listeners = 0;

/** Analyse an existing track only; never acquire, enable, clone or play a microphone. */
export function watchVoiceLevel(track: MediaStreamTrack, onLevel: (level: number) => void): () => void {
    if (track.readyState !== 'live' || typeof AudioContext === 'undefined') return () => {};
    let context: AudioContext;
    let source: MediaStreamAudioSourceNode | undefined;
    let analyser: AnalyserNode | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let stopped = false;
    const gate = createVoiceLevel();
    const resume = () => { if (context?.state === 'suspended') context.resume().catch(() => {}); };
    const stop = () => {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
        source?.disconnect();
        analyser?.disconnect();
        track.removeEventListener('ended', stop);
        window.removeEventListener('pointerdown', resume);
        document.removeEventListener('visibilitychange', visibility);
        onLevel(0);
        if (context && --listeners === 0) {
            sharedContext = null;
            context.close().catch(() => {});
        }
    };
    const visibility = () => { if (document.hidden) onLevel(0); else resume(); };
    try {
        context = sharedContext ??= new AudioContext();
        listeners++;
        source = context.createMediaStreamSource(new MediaStream([track]));
        analyser = context.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        timer = setInterval(() => {
            if (document.hidden || !track.enabled || track.muted || context.state !== 'running') { onLevel(0); return; }
            analyser!.getFloatTimeDomainData(samples);
            let sum = 0;
            for (const sample of samples) sum += sample * sample;
            onLevel(gate(Math.sqrt(sum / samples.length), Date.now()));
        }, 100);
        track.addEventListener('ended', stop, { once: true });
        window.addEventListener('pointerdown', resume);
        document.addEventListener('visibilitychange', visibility);
        resume();
    } catch { stop(); }
    return stop;
}
