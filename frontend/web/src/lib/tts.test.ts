import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeTranslationPipeline, TextToSpeechEngine } from './realtime-translation';

let voices: SpeechSynthesisVoice[];
let synth: EventTarget & { getVoices: ReturnType<typeof vi.fn>; speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
class Utterance {
    text: string;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) { this.text = text; }
}
const voice = (lang: string, localService = true) => ({ lang, localService, name: lang }) as SpeechSynthesisVoice;
beforeEach(() => {
    voices = [voice('en-US'), voice('hi-IN', false)];
    synth = Object.assign(new EventTarget(), { getVoices: vi.fn(() => voices), speak: vi.fn(), cancel: vi.fn() });
    vi.stubGlobal('window', { speechSynthesis: synth });
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
});
afterEach(() => vi.unstubAllGlobals());

describe('actual TextToSpeechEngine', () => {
    it('safely declines when browser speech synthesis is unavailable', () => {
        vi.stubGlobal('window', {});
        const engine = new TextToSpeechEngine({ language: 'hi-IN' });
        engine.start();
        expect(engine.speak('नमस्ते')).toBe(false);
        expect(TextToSpeechEngine.hasVoice('hi')).toBe(false);
        expect(TextToSpeechEngine.getAvailableVoices()).toEqual({});
        engine.dispose();
    });
    it('requires a matching voice and exposes local versus remote capability', () => {
        const engine = new TextToSpeechEngine({ language: 'hi-IN', preferredVoice: 'en-US' });
        engine.start();
        expect(engine.getVoiceSupport('hi')).toEqual({ supported: true, local: false, remote: true });
        expect(TextToSpeechEngine.hasVoice('hi', true)).toBe(false);
        expect(engine.speak('Bonjour', 'fr-FR')).toBe(false);
        expect(synth.speak).not.toHaveBeenCalled();
        expect(engine.speak('नमस्ते')).toBe(true);
        expect(synth.speak.mock.calls[0][0].voice.lang).toBe('hi-IN');
        engine.dispose();
    });
    it('reports actual start/end and cancels the old language queue', () => {
        const onSpeakingChange = vi.fn();
        const engine = new TextToSpeechEngine({ language: 'hi-IN', onSpeakingChange });
        engine.start();
        engine.speak('पहला');
        engine.speak('दूसरा');
        const old = synth.speak.mock.calls[0][0];
        const staleEnd = old.onend;
        expect(onSpeakingChange).not.toHaveBeenCalled();
        old.onstart();
        expect(onSpeakingChange).toHaveBeenLastCalledWith(true);
        engine.setLanguage('en-US');
        expect(onSpeakingChange).toHaveBeenLastCalledWith(false);
        expect(synth.cancel).toHaveBeenCalledOnce();
        engine.speak('New');
        staleEnd();
        expect(synth.speak).toHaveBeenCalledTimes(2);
        const current = synth.speak.mock.calls[1][0];
        current.onend();
        expect(onSpeakingChange).toHaveBeenLastCalledWith(false);
        expect(current.voice.lang).toBe('en-US');
        engine.dispose();
    });
    it('listens alongside other voice listeners and removes its listener on dispose', () => {
        const other = vi.fn(); synth.addEventListener('voiceschanged', other);
        const engine = new TextToSpeechEngine({ language: 'fr-FR' });
        const remove = vi.spyOn(synth, 'removeEventListener');
        voices = [voice('fr-FR')]; synth.dispatchEvent(new Event('voiceschanged'));
        expect(other).toHaveBeenCalledOnce();
        expect(engine.getBestVoice('fr-FR')).not.toBeNull();
        engine.dispose();
        expect(remove).toHaveBeenCalledWith('voiceschanged', expect.any(Function));
        engine.start();
        expect(engine.speak('Bonjour')).toBe(false);
    });
    it('returns false when synthesis rejects immediately', () => {
        synth.speak.mockImplementation(() => { throw new Error('Unavailable'); });
        const engine = new TextToSpeechEngine({ language: 'en-US' }); engine.start();
        expect(engine.speak('Hello')).toBe(false);
        engine.dispose();
    });
    it('restarts an existing voice engine when pipeline TTS is turned back on', async () => {
        const pipeline = new RealtimeTranslationPipeline({ speakerLanguage: 'en-US', listenerLanguage: 'en-US', enableTTS: true });
        pipeline.start();
        await pipeline.processCaption('First', true);
        pipeline.setTTSEnabled(false);
        pipeline.setTTSEnabled(true);
        await pipeline.processCaption('Second', true);
        expect(synth.speak).toHaveBeenCalledTimes(2);
        pipeline.stop();
    });
});
