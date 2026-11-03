import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMutedSpeechGate, watchMutedSpeech } from './muted-speech';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('muted speech reminder', () => {
    it('requires sustained sound and resets the speaking window after a quiet burst', () => {
        const gate = createMutedSpeechGate();
        expect(gate(0.1, 0)).toBe(false);
        expect(gate(0.1, 200)).toBe(false);
        expect(gate(0, 300)).toBe(false);
        expect(gate(0.1, 400)).toBe(false);
        expect(gate(0.1, 800)).toBe(true);
    });

    it('repeats during continuous sound only after the twelve-second cooldown', () => {
        const gate = createMutedSpeechGate();
        gate(0.1, 0);
        expect(gate(0.1, 400)).toBe(true);
        expect(gate(0.1, 800)).toBe(false);
        expect(gate(0.1, 12000)).toBe(false);
        expect(gate(0.1, 12400)).toBe(true);
        expect(gate(0.1, 12800)).toBe(false);
    });

    it('requires fresh sustained sound after silence, even when the cooldown has passed', () => {
        const gate = createMutedSpeechGate();
        gate(0.1, 0);
        gate(0.1, 400);
        gate(0, 12000);
        expect(gate(0.1, 12400)).toBe(false);
        expect(gate(0.1, 12700)).toBe(false);
        expect(gate(0.1, 12800)).toBe(true);
    });

    it('analyses only a clone and releases it, the context and polling when hidden', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const page = Object.assign(new EventTarget(), { hidden: false });
        vi.stubGlobal('document', page);
        vi.stubGlobal('window', new EventTarget());
        const clone = { enabled: false, stop: vi.fn() };
        const original = Object.assign(new EventTarget(), { readyState: 'live', enabled: false, clone: vi.fn(() => clone) });
        const analyser = { fftSize: 0, getFloatTimeDomainData: (data: Float32Array) => data.fill(0.1), disconnect: vi.fn() };
        const source = { connect: vi.fn(), disconnect: vi.fn() };
        const close = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('AudioContext', class {
            state = 'running';
            createMediaStreamSource = vi.fn(() => source);
            createAnalyser = vi.fn(() => analyser);
            close = close;
        });
        const streams: unknown[][] = [];
        vi.stubGlobal('MediaStream', class { constructor(tracks: unknown[]) { streams.push(tracks); } });
        const remind = vi.fn();
        const stop = watchMutedSpeech(original as unknown as MediaStreamTrack, remind);
        vi.advanceTimersByTime(500);
        expect(remind).toHaveBeenCalledOnce();
        expect(original.enabled).toBe(false);
        expect(clone.enabled).toBe(true);
        expect(streams).toEqual([[clone]]);
        expect(source.connect).toHaveBeenCalledExactlyOnceWith(analyser);
        page.hidden = true;
        page.dispatchEvent(new Event('visibilitychange'));
        expect(clone.stop).toHaveBeenCalledOnce();
        expect(source.disconnect).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
        stop();
        expect(clone.stop).toHaveBeenCalledOnce();
    });

    it('does not emit a reminder when the browser blocks audio analysis', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
        vi.stubGlobal('window', new EventTarget());
        const clone = { enabled: false, stop: vi.fn() };
        const original = Object.assign(new EventTarget(), { readyState: 'live', clone: () => clone });
        const close = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('AudioContext', class {
            state = 'suspended';
            createMediaStreamSource = () => ({ connect() {}, disconnect() {} });
            createAnalyser = () => ({ fftSize: 512, disconnect() {} });
            resume = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
            close = close;
        });
        vi.stubGlobal('MediaStream', class {});
        const remind = vi.fn();
        watchMutedSpeech(original as unknown as MediaStreamTrack, remind);
        await vi.runAllTimersAsync();
        expect(remind).not.toHaveBeenCalled();
        expect(clone.stop).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });
});
