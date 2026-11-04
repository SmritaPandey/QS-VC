/**
 * Opening microphones and cameras reliably, including external USB / Bluetooth / Continuity devices.
 *
 * External devices fail in ways built-in ones rarely do:
 *  - the pre-join preview (or another app) still holds the device for a moment → NotReadableError / AbortError;
 *  - the saved deviceId no longer exists (unplugged, re-paired, new id after reboot) → OverconstrainedError / NotFoundError;
 *  - the browser never answers (driver stuck, virtual camera, device asleep) → the promise hangs forever.
 * Each case used to leave the meeting without media or stuck "connecting". Here every attempt is time-limited,
 * a busy device is retried once, and the system default device is the final fallback.
 */

export const DEVICE_TIMEOUT_MS = 10_000;

export class DeviceTimeoutError extends Error {
    constructor(kind: 'microphone' | 'camera') {
        super(`Your ${kind} is taking too long to start.`);
        this.name = 'DeviceTimeoutError';
    }
}

const BUSY = new Set(['NotReadableError', 'AbortError', 'TrackStartError']);
const MISSING = new Set(['OverconstrainedError', 'NotFoundError', 'DevicesNotFoundError', 'ConstraintNotSatisfiedError']);
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Resolve within `ms`, otherwise reject; a late result is handed to `onLate` so it can be released. */
export function withTimeout<T>(promise: Promise<T>, ms: number, error: () => Error, onLate?: (value: T) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => { settled = true; reject(error()); }, ms);
        promise.then(value => {
            if (settled) { onLate?.(value); return; }
            settled = true; clearTimeout(timer); resolve(value);
        }, reason => {
            if (settled) return;
            settled = true; clearTimeout(timer); reject(reason);
        });
    });
}

const stopStream = (stream: MediaStream) => stream.getTracks().forEach(track => track.stop());

/**
 * Try the chosen device, then the same device again after a short pause if it was busy,
 * then the system default. Returns the stream and whether we fell back to another device.
 */
async function openWithFallback(
    kind: 'microphone' | 'camera',
    build: (deviceId?: string) => MediaStreamConstraints,
    deviceId: string | undefined,
    timeoutMs: number,
): Promise<{ stream: MediaStream; fellBack: boolean }> {
    const attempt = (id?: string) => withTimeout(navigator.mediaDevices.getUserMedia(build(id)), timeoutMs, () => new DeviceTimeoutError(kind), stopStream);
    let lastError: unknown;
    const plan: Array<{ id?: string; delay: number }> = deviceId
        ? [{ id: deviceId, delay: 0 }, { id: deviceId, delay: 700 }, { id: undefined, delay: 0 }]
        : [{ id: undefined, delay: 0 }, { id: undefined, delay: 700 }];
    for (const [index, step] of plan.entries()) {
        const name = (lastError as { name?: string } | undefined)?.name || '';
        // Only retry the same device when it was busy; a missing device goes straight to the default.
        if (index > 0 && step.id && !BUSY.has(name)) continue;
        if (index > 0 && !step.id && name === 'NotAllowedError') break;
        if (step.delay) await wait(step.delay);
        try {
            const stream = await attempt(step.id);
            return { stream, fellBack: !!deviceId && !step.id };
        } catch (error) {
            lastError = error;
            const errorName = (error as { name?: string }).name || '';
            if (errorName === 'NotAllowedError' || errorName === 'SecurityError') break;
            if (error instanceof DeviceTimeoutError && !deviceId) break;
            if (!BUSY.has(errorName) && !MISSING.has(errorName) && !(error instanceof DeviceTimeoutError)) break;
        }
    }
    throw lastError;
}

export function openMicrophone(deviceId?: string, timeoutMs = DEVICE_TIMEOUT_MS) {
    return openWithFallback('microphone', id => ({
        audio: { ...(id ? { deviceId: { ideal: id } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
    }), deviceId, timeoutMs);
}

export function cameraConstraints(deviceId?: string): MediaTrackConstraints {
    // `ideal` sizes: external cameras that cannot do 1280×720 still open at their best size.
    return { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 }, ...(deviceId ? { deviceId: { ideal: deviceId } } : {}) };
}

/** Plain-language reason for a microphone that could not start. */
export function microphoneMessage(error: unknown): string {
    const name = (error as { name?: string } | null)?.name;
    if (error instanceof DeviceTimeoutError) return 'Your microphone is taking too long to start. Check it is connected, then press the mic button.';
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone permission is blocked. Allow it in your browser settings, then press the mic button.';
    if (name && BUSY.has(name)) return 'Your microphone is in use by another app. Close it, then press the mic button.';
    if (name && MISSING.has(name)) return 'No microphone found. Connect one and press the mic button.';
    return 'Microphone unavailable. You can still listen and chat.';
}

/** Friendly label of the device a track came from (for "Switched to …" notices). */
export function deviceLabel(track?: MediaStreamTrack | null): string {
    const label = track?.label?.trim();
    return label ? label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '') : 'your default device';
}

/**
 * Start a camera through CameraCapture (which discards late results itself) with the same
 * busy-retry and default-device fallback as microphones.
 */
export async function startCameraWithFallback(
    start: (constraints: MediaTrackConstraints) => Promise<MediaStreamTrack | null>,
    deviceId?: string,
    timeoutMs = DEVICE_TIMEOUT_MS,
): Promise<{ track: MediaStreamTrack | null; fellBack: boolean }> {
    const attempt = (id?: string) => withTimeout(start(cameraConstraints(id)), timeoutMs, () => new DeviceTimeoutError('camera'), track => track?.stop());
    try {
        return { track: await attempt(deviceId), fellBack: false };
    } catch (error) {
        const name = (error as { name?: string }).name || '';
        if (name === 'NotAllowedError' || name === 'SecurityError') throw error;
        if (BUSY.has(name)) {
            await wait(700);
            try { return { track: await attempt(deviceId), fellBack: false }; } catch (again) {
                if (!deviceId) throw again;
            }
        } else if (!deviceId || !(MISSING.has(name) || error instanceof DeviceTimeoutError)) throw error;
        return { track: await attempt(undefined), fellBack: true };
    }
}
