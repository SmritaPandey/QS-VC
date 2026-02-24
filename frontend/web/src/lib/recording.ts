/**
 * Recording Manager: handles client-side recording via MediaRecorder API.
 */
export class RecordingManager {
    private mediaRecorder: MediaRecorder | null = null;
    private recordedChunks: Blob[] = [];
    private startTime = 0;

    get isRecording(): boolean {
        return this.mediaRecorder?.state === 'recording';
    }

    get duration(): number {
        if (!this.startTime) return 0;
        return Math.floor((Date.now() - this.startTime) / 1000);
    }

    /**
     * Start recording from a MediaStream (composite of all video/audio).
     */
    async startRecording(stream: MediaStream): Promise<void> {
        if (this.isRecording) return;

        const mimeTypes = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm',
            'video/mp4',
        ];

        let selectedMime = '';
        for (const mime of mimeTypes) {
            if (MediaRecorder.isTypeSupported(mime)) {
                selectedMime = mime;
                break;
            }
        }

        if (!selectedMime) {
            throw new Error('No supported recording format found');
        }

        this.recordedChunks = [];
        this.mediaRecorder = new MediaRecorder(stream, {
            mimeType: selectedMime,
            videoBitsPerSecond: 2500000, // 2.5 Mbps
        });

        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                this.recordedChunks.push(event.data);
            }
        };

        this.mediaRecorder.start(1000); // Capture in 1-second chunks
        this.startTime = Date.now();
        console.log(`[Recording] Started with ${selectedMime}`);
    }

    /**
     * Stop recording and return the recorded blob.
     */
    async stopRecording(): Promise<{ blob: Blob; duration: number; format: string }> {
        return new Promise((resolve, reject) => {
            if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
                reject(new Error('Not recording'));
                return;
            }

            const duration = this.duration;
            const format = this.mediaRecorder.mimeType.includes('mp4') ? 'mp4' : 'webm';

            this.mediaRecorder.onstop = () => {
                const blob = new Blob(this.recordedChunks, { type: this.mediaRecorder!.mimeType });
                this.recordedChunks = [];
                this.startTime = 0;
                console.log(`[Recording] Stopped: ${blob.size} bytes, ${duration}s`);
                resolve({ blob, duration, format });
            };

            this.mediaRecorder.stop();
        });
    }

    /**
     * Upload recording to the recording service.
     */
    async uploadRecording(
        recordingId: string,
        blob: Blob,
        duration: number,
        format: string
    ): Promise<void> {
        const recordingUrl = import.meta.env.VITE_RECORDING_URL || 'http://localhost:4004';

        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve) => {
            reader.onload = () => {
                const result = reader.result as string;
                resolve(result.split(',')[1]); // Strip data URL prefix
            };
            reader.readAsDataURL(blob);
        });

        const response = await fetch(`${recordingUrl}/api/recordings/${recordingId}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: base64, format, durationSec: duration }),
        });

        if (!response.ok) {
            throw new Error(`Upload failed: ${response.statusText}`);
        }

        console.log(`[Recording] Uploaded to server: ${recordingId}`);
    }

    /**
     * Download recording locally.
     */
    downloadLocally(blob: Blob, filename: string): void {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }
}

export const recordingManager = new RecordingManager();
