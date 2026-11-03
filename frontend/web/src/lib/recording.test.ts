import { expect, it } from 'vitest';
import { RecordingManager } from './recording';
it('cannot start local recording in the demo', async () => { const recorder = new RecordingManager(); await expect(recorder.startRecording({} as MediaStream)).rejects.toThrow('disabled'); expect(recorder.isRecording).toBe(false); });
