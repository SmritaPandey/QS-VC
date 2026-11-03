import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpeechToTextEngine } from './speech-to-text';

class Recognition {
    static instances: Recognition[] = [];
    lang = '';
    onresult: ((event: any) => void) | null = null;
    onerror: ((event: any) => void) | null = null;
    onend: (() => void) | null = null;
    start = vi.fn();
    abort = vi.fn();
    constructor() { Recognition.instances.push(this); }
}
function result(text: string, final: boolean) {
    return { resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: final })] };
}
beforeEach(() => {
    Recognition.instances = [];
    vi.stubGlobal('window', { SpeechRecognition: Recognition });
});
afterEach(() => vi.unstubAllGlobals());

describe('browser speech recognition lifecycle', () => {
    it('updates one utterance from interim to final and resets identity after normal restart', () => {
        const onCaption = vi.fn();
        const engine = new SpeechToTextEngine('Synthetic Speaker', { onCaption });
        engine.start();
        const first = Recognition.instances[0];
        first.onresult!(result('hel', false));
        first.onresult!(result('hello', true));
        expect(onCaption.mock.calls[0][0].id).toBe(onCaption.mock.calls[1][0].id);
        expect(onCaption.mock.calls[1][0]).toMatchObject({ text: 'hello', isFinal: true, speakerName: 'Synthetic Speaker' });
        first.onend!();
        Recognition.instances[1].onresult!(result('next', true));
        expect(onCaption.mock.calls[2][0].id).not.toBe(onCaption.mock.calls[1][0].id);
        engine.stop();
    });
    it.each(['not-allowed', 'service-not-allowed', 'network', 'audio-capture'])('stops after %s instead of restarting', error => {
        const onError = vi.fn();
        const engine = new SpeechToTextEngine('Demo', { onError });
        engine.start();
        const recognition = Recognition.instances[0];
        const lateEnd = recognition.onend!;
        recognition.onerror!({ error });
        lateEnd();
        expect(engine.isActive()).toBe(false);
        expect(Recognition.instances).toHaveLength(1);
        expect(onError).toHaveBeenCalledOnce();
        expect(recognition.abort).toHaveBeenCalledOnce();
    });
    it('discards late callbacks after stop and after switching languages', () => {
        const onCaption = vi.fn();
        const engine = new SpeechToTextEngine('Demo', { onCaption });
        engine.start();
        const first = Recognition.instances[0];
        const oldResult = first.onresult!;
        const oldEnd = first.onend!;
        engine.setLanguage('hi-IN');
        oldResult(result('stale', true)); oldEnd();
        expect(Recognition.instances).toHaveLength(2);
        expect(Recognition.instances[1].lang).toBe('hi-IN');
        const currentResult = Recognition.instances[1].onresult!;
        engine.stop(); currentResult(result('late', true));
        expect(onCaption).not.toHaveBeenCalled();
        expect(first.onresult).toBeNull(); expect(first.onerror).toBeNull(); expect(first.onend).toBeNull();
    });
    it('reports missing browser support without starting capture', () => {
        vi.stubGlobal('window', {});
        const onError = vi.fn();
        expect(SpeechToTextEngine.isSupported()).toBe(false);
        const engine = new SpeechToTextEngine('Demo', { onError }); engine.start();
        expect(engine.isActive()).toBe(false); expect(onError).toHaveBeenCalledOnce();
        expect(Recognition.instances).toHaveLength(0);
    });
    it('supports the prefixed API and leaves one-shot recognition stopped', () => {
        vi.stubGlobal('window', { webkitSpeechRecognition: Recognition });
        const engine = new SpeechToTextEngine('Demo', { continuous: false });
        engine.start(); Recognition.instances[0].onend!();
        expect(engine.isActive()).toBe(false); expect(Recognition.instances).toHaveLength(1);
    });
    it('allows a normal restart after a no-speech result', () => {
        const onError = vi.fn();
        const engine = new SpeechToTextEngine('Demo', { onError });
        engine.start();
        Recognition.instances[0].onerror!({ error: 'no-speech' });
        Recognition.instances[0].onend!();
        expect(engine.isActive()).toBe(true); expect(Recognition.instances).toHaveLength(2);
        expect(onError).not.toHaveBeenCalled(); engine.stop();
    });
    it('stays inactive when the browser rejects recognition startup', () => {
        class RejectedRecognition extends Recognition {
            start = vi.fn(() => { throw new Error('capture unavailable'); });
        }
        vi.stubGlobal('window', { SpeechRecognition: RejectedRecognition });
        const onError = vi.fn(); const engine = new SpeechToTextEngine('Demo', { onError });
        engine.start();
        expect(engine.isActive()).toBe(false); expect(onError).toHaveBeenCalledOnce();
        expect(Recognition.instances[0].onresult).toBeNull();
    });
});
