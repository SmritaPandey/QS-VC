import { getToken } from './session';

export interface CloudRecording { id: string; meetingCode: string; createdAt: string; size: number; format: string }
const API = import.meta.env.VITE_RECORDING_URL || '';
export const MAX_RECORDING_BYTES = 80 * 1024 * 1024;

export async function recordingRequest(path: string, options: RequestInit = {}, shared = false) {
    const headers = new Headers(options.headers);
    if (!shared) {
        const token = getToken();
        if (!token) throw new Error('Sign in as the meeting host to manage recordings.');
        headers.set('Authorization', `Bearer ${token}`);
    }
    const response = await fetch(`${API}/api/recordings/${path}`, { ...options, headers });
    if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'Recording request failed. Try again.');
    }
    return response.status === 204 ? null : response.json();
}

export interface PendingRecording { blob: Blob; format: string; meetingCode: string; id: string }
type Recorded = { blob: Blob; duration: number; format: string };
export class RecordingManager {
    pending: PendingRecording | null = null;
    private completion: Promise<Recorded> | null = null;
    private mediaRecorder: MediaRecorder | null = null;
    private recordedChunks: Blob[] = [];
    private startTime = 0;
    private bytes = 0;
    get isRecording() { return this.mediaRecorder?.state === 'recording'; }
    get duration() { return this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0; }

    async startRecording(stream: MediaStream, onLimit: () => void = () => {}) {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') throw new Error('Recording is already running.');
        if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record meetings. Use a supported desktop browser.');
        const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type));
        if (!mimeType) throw new Error('This browser has no supported recording format.');
        const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1_200_000, audioBitsPerSecond: 96_000 });
        this.recordedChunks = []; this.bytes = 0;
        recorder.ondataavailable = event => {
            if (event.data.size) { this.recordedChunks.push(event.data); this.bytes += event.data.size; }
            // Leave headroom for the final browser chunk below the service upload limit.
            if (this.bytes >= MAX_RECORDING_BYTES - 10 * 1024 * 1024 && recorder.state === 'recording') onLimit();
        };
        this.completion = new Promise((resolve, reject) => {
            recorder.onstop = () => {
                const blob = new Blob(this.recordedChunks, { type: recorder.mimeType });
                const duration = this.duration;
                this.recordedChunks = []; this.startTime = 0;
                if (blob.size) resolve({ blob, duration, format: recorder.mimeType.includes('mp4') ? 'mp4' : 'webm' });
                else reject(new Error('The browser produced an empty recording.'));
                queueMicrotask(onLimit);
            };
            recorder.onerror = () => { if (recorder.state !== 'inactive') recorder.stop(); };
        });
        // Native encoder stop can happen before the user presses Stop.
        void this.completion.catch(() => {});
        recorder.start(1000);
        this.mediaRecorder = recorder;
        this.startTime = Date.now();
    }

    async stopRecording(): Promise<Recorded> {
        if (!this.mediaRecorder || !this.completion) throw new Error('No recording is running.');
        if (this.mediaRecorder.state !== 'inactive') this.mediaRecorder.stop();
        return this.completion;
    }

    async uploadRecording(meetingCode: string, blob: Blob, id: string = crypto.randomUUID()): Promise<CloudRecording> {
        if (blob.size > MAX_RECORDING_BYTES) throw new Error('Recording exceeds the 80 MB demo limit. Keep it open and download it manually.');
        return recordingRequest(encodeURIComponent(meetingCode), { method: 'POST', headers: { 'Content-Type': blob.type.includes('mp4') ? 'video/mp4' : 'video/webm', 'X-Recording-Id': id }, body: blob });
    }

    downloadLocally(blob: Blob, filename: string) {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url; anchor.download = filename;
        document.body.appendChild(anchor); anchor.click(); anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
}
export const recordingManager = new RecordingManager();
