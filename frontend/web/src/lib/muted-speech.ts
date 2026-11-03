/** A local level reminder, not speech recognition; repeat during continuing sound at most once every twelve seconds. */
export function createMutedSpeechGate(): (level: number, now: number) => boolean {
    let started: number | null = null;
    let lastReminder = -Infinity;
    return (level, now) => {
        if (level < 0.035) { started = null; return false; }
        started ??= now;
        if (now - started < 400 || now - lastReminder < 12000) return false;
        lastReminder = now;
        started = null;
        return true;
    };
}

/** The enabled clone is analysed locally only, never added to a producer, recorder or audio output. */
export function watchMutedSpeech(original: MediaStreamTrack, onSpeech: () => void): () => void {
    if (original.readyState !== 'live' || document.hidden || typeof AudioContext === 'undefined') return () => {};
    let clone: MediaStreamTrack | null = null;
    let context: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let stopped = false;
    const stop = () => {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
        clone?.stop();
        source?.disconnect();
        analyser?.disconnect();
        context?.close().catch(() => {});
        original.removeEventListener('ended', stop);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pagehide', stop);
    };
    const onVisibility = () => { if (document.hidden) stop(); };
    try {
        clone = original.clone();
        clone.enabled = true;
        context = new AudioContext();
        source = context.createMediaStreamSource(new MediaStream([clone]));
        analyser = context.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const shouldRemind = createMutedSpeechGate();
        const poll = () => {
            if (stopped || !context || context.state !== 'running' || !analyser) return;
            analyser.getFloatTimeDomainData(samples);
            const level = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
            if (shouldRemind(level, Date.now())) onSpeech();
        };
        original.addEventListener('ended', stop, { once: true });
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('pagehide', stop);
        if (context.state === 'running') timer = setInterval(poll, 100);
        else context.resume().then(() => {
            if (stopped) return;
            if (context?.state === 'running') timer = setInterval(poll, 100);
            else stop();
        }).catch(stop);
    } catch { stop(); }
    return stop;
}
