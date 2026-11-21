import { afterEach, expect, it, vi } from 'vitest';
import { signaling } from './signaling';
import { ServerSpeechEngine } from './server-speech';

vi.mock('./signaling', () => ({ signaling: { request: vi.fn(), notify: vi.fn(), on: vi.fn(() => () => {}) } }));
afterEach(() => vi.resetAllMocks());

it.each([true, false])('a cancelled recognition start cannot stop the next language session or report a stale error (%s)', async success => {
    let finish!: () => void;
    vi.mocked(signaling.request).mockImplementationOnce(() => new Promise((resolve, reject) => {
        finish = () => success ? resolve({}) : reject(new Error('closed'));
    })).mockResolvedValue({});
    const onError = vi.fn();
    const engine = new ServerSpeechEngine({ language: 'hi', processorConsent: true, getTrack: () => ({ readyState: 'live' } as MediaStreamTrack), onError });
    const started = engine.start();
    engine.stop();
    finish();
    await started;
    expect(vi.mocked(signaling.request).mock.calls.map(([method]) => method)).toEqual(['asrStart', 'asrStop']);
    expect(signaling.notify).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
});
