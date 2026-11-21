import { afterEach, expect, it, vi } from 'vitest';
import { MeetingVoice } from './meeting-voice';
import { signaling } from './signaling';
vi.mock('./signaling', () => ({ signaling: { request: vi.fn() } }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('plays the room translation without a device voice and discards pending audio on stop', async () => {
    const source = { connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: () => {} };
    const decode = vi.fn().mockResolvedValue({});
    vi.stubGlobal('AudioContext', class {
        state = 'running';
        resume = vi.fn();
        decodeAudioData = decode;
        createBufferSource = () => source;
        close = vi.fn().mockResolvedValue(undefined);
    });
    vi.mocked(signaling.request).mockResolvedValue({ wav: 'AA==' });
    const voice = new MeetingVoice(), speaking = vi.fn(), failed = vi.fn();
    voice.enqueue('first', 'ja', speaking, failed);
    voice.enqueue('second', 'ja', speaking, failed);
    await vi.waitFor(() => expect(source.start).toHaveBeenCalledOnce());
    expect(signaling.request).toHaveBeenCalledWith('captionVoice', { id: 'first', target: 'ja' });
    expect(speaking).toHaveBeenCalledWith(true);
    voice.stop();
    source.onended();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(signaling.request).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
});
