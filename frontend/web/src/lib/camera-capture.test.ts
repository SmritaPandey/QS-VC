import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraCapture, watchCameraVisibility, watchCameraTrack, cameraAccessMessage } from './camera-capture';

function cameraStream() {
    const track = { stop: vi.fn(), kind: 'video' } as unknown as MediaStreamTrack;
    return { track, stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream };
}

afterEach(() => vi.unstubAllGlobals());

describe('camera capture privacy lifecycle', () => {
    it('stops a permission result that arrives after leaving or turning the camera off', async () => {
        let resolve!: (stream: MediaStream) => void;
        vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(() => new Promise<MediaStream>(done => { resolve = done; })) } });
        vi.stubGlobal('document', { hidden: false });
        const capture = new CameraCapture();
        const opening = capture.start({ width: 1280 });
        capture.stop();
        const { track, stream } = cameraStream();
        resolve(stream);
        expect(await opening).toBeNull();
        expect(track.stop).toHaveBeenCalledOnce();
    });

    it('releases the live track and never restarts when the tab becomes visible again', async () => {
        const first = cameraStream();
        const second = cameraStream();
        const getUserMedia = vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream);
        vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
        const page = Object.assign(new EventTarget(), { hidden: false });
        vi.stubGlobal('document', page);
        const capture = new CameraCapture();
        expect(await capture.start({})).toBe(first.track);
        const turnOff = vi.fn(() => capture.stop());
        const stopWatching = watchCameraVisibility(turnOff);
        page.hidden = true;
        page.dispatchEvent(new Event('visibilitychange'));
        page.hidden = false;
        page.dispatchEvent(new Event('visibilitychange'));
        expect(turnOff).toHaveBeenCalledOnce();
        expect(first.track.stop).toHaveBeenCalledOnce();
        expect(getUserMedia).toHaveBeenCalledTimes(1);
        expect(await capture.start({})).toBe(second.track);
        expect(getUserMedia).toHaveBeenCalledTimes(2);
        stopWatching();
        page.hidden = true;
        page.dispatchEvent(new Event('visibilitychange'));
        expect(turnOff).toHaveBeenCalledOnce();
    });

    it('rejects a result while hidden even if the visibility event has not run yet', async () => {
        const { track, stream } = cameraStream();
        vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) } });
        vi.stubGlobal('document', { hidden: true });
        expect(await new CameraCapture().start({})).toBeNull();
        expect(track.stop).toHaveBeenCalledOnce();
    });
});

describe('camera restart recovery', () => {
    it('keeps a fresh live camera while its source is temporarily muted', async () => {
        const track = Object.assign(new EventTarget(), { kind: 'video', readyState: 'live', muted: true, stop: vi.fn() });
        const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
        vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) } });
        vi.stubGlobal('document', { hidden: false });
        const capture = new CameraCapture();
        expect(await capture.start({})).toBe(track);
        const ended = vi.fn();
        const interrupted = vi.fn();
        watchCameraTrack(track as unknown as MediaStreamTrack, ended, interrupted);
        expect(interrupted).toHaveBeenLastCalledWith(true);
        track.muted = false;
        track.dispatchEvent(new Event('unmute'));
        expect(interrupted).toHaveBeenLastCalledWith(false);
        track.muted = true;
        track.dispatchEvent(new Event('mute'));
        expect(ended).not.toHaveBeenCalled();
        expect(track.stop).not.toHaveBeenCalled();
        track.dispatchEvent(new Event('ended'));
        expect(ended).toHaveBeenCalledOnce();
        capture.stop();
        expect(track.stop).toHaveBeenCalledOnce();
    });

    it('distinguishes camera permission, device-busy and missing-device failures', () => {
        expect(cameraAccessMessage({ name: 'NotAllowedError' })).toContain('permission is blocked');
        expect(cameraAccessMessage({ name: 'NotReadableError' })).toContain('Camera is busy');
        expect(cameraAccessMessage({ name: 'NotFoundError' })).toContain('Camera not found');
        expect(cameraAccessMessage(new Error('unknown'))).toBe('Could not start the camera. Try again.');
    });
});
