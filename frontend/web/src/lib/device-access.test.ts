import { describe, it, expect, vi, afterEach } from 'vitest';
import { openMicrophone, startCameraWithFallback, withTimeout, DeviceTimeoutError, microphoneMessage } from './device-access';

const fakeStream = (label = 'Mic') => { const tracks = [{ stop: vi.fn(), label }]; return { getTracks: () => tracks, getAudioTracks: () => tracks } as unknown as MediaStream; };
const domError = (name: string) => Object.assign(new Error(name), { name });
const stubGetUserMedia = (impl: (c: MediaStreamConstraints) => Promise<MediaStream>) => {
    const fn = vi.fn(impl);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: fn } });
    return fn;
};
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('external microphones', () => {
    it('retries a busy chosen device, then uses it', async () => {
        let calls = 0;
        const gum = stubGetUserMedia(async () => { if (calls++ === 0) throw domError('NotReadableError'); return fakeStream('USB mic'); });
        const result = await openMicrophone('usb-1');
        expect(result.fellBack).toBe(false);
        expect(gum).toHaveBeenCalledTimes(2);
        expect((gum.mock.calls[1][0].audio as MediaTrackConstraints).deviceId).toEqual({ ideal: 'usb-1' });
    });
    it('falls back to the default device when the chosen one is unplugged', async () => {
        const gum = stubGetUserMedia(async c => { if ((c.audio as MediaTrackConstraints).deviceId) throw domError('OverconstrainedError'); return fakeStream('Built-in'); });
        const result = await openMicrophone('gone');
        expect(result.fellBack).toBe(true);
        expect(gum).toHaveBeenCalledTimes(2);
    });
    it('falls back when the chosen device never answers, and stops it if it answers late', async () => {
        const late = fakeStream('Stuck');
        let resolveStuck: (s: MediaStream) => void = () => {};
        stubGetUserMedia(c => (c.audio as MediaTrackConstraints).deviceId ? new Promise(r => { resolveStuck = r; }) : Promise.resolve(fakeStream('Default')));
        const result = await openMicrophone('stuck', 30);
        expect(result.fellBack).toBe(true);
        resolveStuck(late);
        await new Promise(r => setTimeout(r, 0));
        expect((late.getTracks()[0].stop as any)).toHaveBeenCalled();
    });
    it('does not retry when permission is denied', async () => {
        const gum = stubGetUserMedia(async () => { throw domError('NotAllowedError'); });
        await expect(openMicrophone('usb')).rejects.toMatchObject({ name: 'NotAllowedError' });
        expect(gum).toHaveBeenCalledTimes(1);
        expect(microphoneMessage(domError('NotAllowedError'))).toContain('permission');
    });
});

describe('external cameras', () => {
    it('falls back to the default camera when the chosen one times out', async () => {
        const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
        const start = vi.fn((c: MediaTrackConstraints) => c.deviceId ? new Promise<MediaStreamTrack | null>(() => {}) : Promise.resolve(track));
        const result = await startCameraWithFallback(start, 'continuity', 30);
        expect(result).toEqual({ track, fellBack: true });
    });
    it('withTimeout rejects with a device timeout', async () => {
        await expect(withTimeout(new Promise(() => {}), 10, () => new DeviceTimeoutError('camera'))).rejects.toBeInstanceOf(DeviceTimeoutError);
    });
});
