import { afterEach, expect, it, vi } from 'vitest';
import { RecordingManager, recordingRequest } from './recording';

class FakeRecorder {
    static isTypeSupported(type: string) { return type.includes('webm'); }
    static latest: FakeRecorder;
    state = 'inactive';
    mimeType = 'video/webm';
    ondataavailable?: (event: { data: Blob }) => void;
    onstop?: () => void;
    onerror?: () => void;
    constructor() { FakeRecorder.latest = this; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['final'], { type: this.mimeType }) }); this.onstop?.(); }
}
afterEach(() => vi.unstubAllGlobals());
it('records chunks and the final chunk without triggering a download', async () => {
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    const recorder = new RecordingManager();
    const download = vi.spyOn(recorder, 'downloadLocally');
    await recorder.startRecording({} as MediaStream);
    FakeRecorder.latest.ondataavailable?.({ data: new Blob(['first']) });
    expect(recorder.isRecording).toBe(true);
    const result = await recorder.stopRecording();
    expect(await result.blob.text()).toBe('firstfinal');
    expect(result.format).toBe('webm');
    expect(download).not.toHaveBeenCalled();
    expect(recorder.isRecording).toBe(false);
});
it('rejects duplicate starts and unsupported browsers', async () => {
    const recorder = new RecordingManager();
    vi.stubGlobal('MediaRecorder', undefined);
    await expect(recorder.startRecording({} as MediaStream)).rejects.toThrow('cannot record');
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    await recorder.startRecording({} as MediaStream);
    await expect(recorder.startRecording({} as MediaStream)).rejects.toThrow('already');
    await recorder.stopRecording();
});
it('preserves final chunks when the browser stops recording before the user does', async () => {
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    const recorder = new RecordingManager();
    const stopped = vi.fn();
    await recorder.startRecording({} as MediaStream, stopped);
    FakeRecorder.latest.stop();
    const result = await recorder.stopRecording();
    expect(await result.blob.text()).toBe('final');
    await Promise.resolve();
    expect(stopped).toHaveBeenCalledOnce();
});
it('requires a session before cloud requests and propagates storage errors', async () => {
    vi.stubGlobal('localStorage', { removeItem: vi.fn() });
    vi.stubGlobal('sessionStorage', { getItem: () => '' });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(recordingRequest('meeting/ABC')).rejects.toThrow('Sign in');
    expect(fetch).not.toHaveBeenCalled();
    vi.stubGlobal('sessionStorage', { getItem: () => 'test-token' });
    fetch.mockResolvedValue(new Response(JSON.stringify({ error: 'Storage unavailable' }), { status: 503 }));
    await expect(recordingRequest('meeting/ABC')).rejects.toThrow('Storage unavailable');
    expect(fetch.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer test-token');
});
