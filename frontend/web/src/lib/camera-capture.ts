/** Camera requests cannot be cancelled by the browser, so discard late permission results. */
export class CameraCapture {
    private revision = 0;
    private track: MediaStreamTrack | null = null;

    stop(): void {
        this.revision++;
        this.track?.stop();
        this.track = null;
    }

    async start(video: MediaTrackConstraints): Promise<MediaStreamTrack | null> {
        this.stop();
        const revision = this.revision;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
        if (revision !== this.revision || document.hidden) {
            stream.getTracks().forEach(track => track.stop());
            return null;
        }
        this.track = stream.getVideoTracks()[0] ?? null;
        if (this.track?.readyState === 'ended') { this.stop(); return null; }
        return this.track;
    }
}

/** Returning to the tab never restarts a camera without a fresh user action. */
export function watchCameraVisibility(turnOff: () => void): () => void {
    const changed = () => { if (document.hidden) turnOff(); };
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
}

/** A browser mute is a temporary interruption; only an ended track is permanently unavailable. */
export function watchCameraTrack(track: MediaStreamTrack, onEnded: () => void, onInterrupted: (muted: boolean) => void): void {
    track.addEventListener('ended', onEnded, { once: true });
    track.addEventListener('mute', () => onInterrupted(true));
    track.addEventListener('unmute', () => onInterrupted(false));
    if (track.muted) onInterrupted(true);
}

export function cameraAccessMessage(error: unknown): string {
    const name = (error as { name?: string } | null)?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera permission is blocked. Allow camera access in your browser.';
    if (name === 'NotReadableError' || name === 'AbortError') return 'Camera is busy. Close other camera apps or tabs, then try again.';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Camera not found. Connect a camera or choose another device.';
    return 'Could not start the camera. Try again.';
}
