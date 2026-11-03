import { describe, expect, it } from 'vitest';
import { createVoiceLevel } from './voice-activity';

describe('speaking avatar voice level', () => {
    it('ignores quiet background noise and invalid samples', () => {
        const level = createVoiceLevel();
        expect(level(0.01, 0)).toBe(0);
        expect(level(NaN, 100)).toBe(0);
    });
    it('scales with voice volume and caps the visual size', () => {
        const level = createVoiceLevel();
        expect(level(0.06, 0)).toBe(0.5);
        expect(level(0.5, 100)).toBe(1);
    });
    it('bridges short gaps between syllables then returns to rest', () => {
        const level = createVoiceLevel();
        level(0.1, 0);
        expect(level(0, 100)).toBe(0.12);
        expect(level(0, 220)).toBe(0);
    });
});

import { afterEach, vi } from 'vitest';
import { watchVoiceLevel } from './voice-activity';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('uses the existing track, respects mute, and releases analysis without stopping media', () => {
    vi.useFakeTimers();
    const track = Object.assign(new EventTarget(), { readyState: 'live', enabled: true, muted: false, stop: vi.fn(), clone: vi.fn() });
    const page = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal('document', page);
    vi.stubGlobal('window', new EventTarget());
    const analyser = { fftSize: 0, getFloatTimeDomainData: (samples: Float32Array) => samples.fill(0.06), disconnect: vi.fn() };
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const close = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('AudioContext', class {
        state = 'running';
        createMediaStreamSource = vi.fn(() => source);
        createAnalyser = vi.fn(() => analyser);
        close = close;
    });
    const stream = vi.fn();
    vi.stubGlobal('MediaStream', stream);
    const update = vi.fn();
    const stop = watchVoiceLevel(track as unknown as MediaStreamTrack, update);
    vi.advanceTimersByTime(100);
    expect(update.mock.lastCall?.[0]).toBeCloseTo(0.5);
    track.enabled = false;
    vi.advanceTimersByTime(100);
    expect(update).toHaveBeenLastCalledWith(0);
    expect(stream).toHaveBeenCalledWith([track]);
    expect(source.connect).toHaveBeenCalledWith(analyser);
    stop(); stop();
    expect(close).toHaveBeenCalledTimes(1);
    expect(track.stop).not.toHaveBeenCalled();
    expect(track.clone).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
});
