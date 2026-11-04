/**
 * Camera background effects: blur or replace the background behind the person on camera.
 *
 * Uses MediaPipe Selfie Segmentation, self-hosted under /mediapipe/ so it also works on an
 * intranet with no internet access. Everything runs on this device; frames never leave it
 * except as the normal (processed) camera video.
 */

export type BackgroundEffect =
    | { kind: 'none' }
    | { kind: 'blur'; strength: 'light' | 'strong' }
    | { kind: 'image'; id: string; src?: string };

export const BACKGROUND_PRESETS: Array<{ id: string; label: string; stops: string[]; dots?: boolean }> = [
    { id: 'teal', label: 'Calm teal', stops: ['#0b3b3f', '#11706f', '#7fd6c5'] },
    { id: 'dawn', label: 'Dawn', stops: ['#3a1c5c', '#b4456b', '#f2a65a'] },
    { id: 'night', label: 'Night sky', stops: ['#050b1a', '#13254a', '#2b4f8a'], dots: true },
    { id: 'studio', label: 'Studio grey', stops: ['#2c3238', '#4b545c', '#8a949c'] },
    { id: 'brand', label: 'QS-VC', stops: ['#233c86', '#5141be', '#006d77'] },
];

const ASSET_BASE = '/mediapipe/selfie_segmentation/';
const EFFECT_KEY = 'qsvc:background-effect';

export function savedEffect(): BackgroundEffect {
    try {
        const raw = localStorage.getItem(EFFECT_KEY);
        const value = raw ? JSON.parse(raw) : null;
        if (value?.kind === 'blur' && (value.strength === 'light' || value.strength === 'strong')) return value;
        if (value?.kind === 'image' && typeof value.id === 'string') return value;
    } catch { /* per-device preference only */ }
    return { kind: 'none' };
}
export function saveEffect(effect: BackgroundEffect) {
    try {
        // Uploaded pictures can be large; remember them only if small.
        if (effect.kind === 'image' && effect.src && effect.src.length > 1_500_000) localStorage.setItem(EFFECT_KEY, JSON.stringify({ kind: 'none' }));
        else localStorage.setItem(EFFECT_KEY, JSON.stringify(effect));
    } catch { /* storage may be unavailable */ }
}
export const effectLabel = (e: BackgroundEffect) => e.kind === 'none' ? 'No effect' : e.kind === 'blur' ? (e.strength === 'light' ? 'Slight blur' : 'Blur') : BACKGROUND_PRESETS.find(p => p.id === e.id)?.label || 'Your picture';

type Segmenter = { setOptions(o: object): void; onResults(cb: (r: { segmentationMask: CanvasImageSource }) => void): void; initialize(): Promise<void>; send(i: { image: CanvasImageSource }): Promise<void>; close(): Promise<void> };
let loader: Promise<new (config: { locateFile: (f: string) => string }) => Segmenter> | null = null;

function loadMediaPipe() {
    loader ??= new Promise((resolve, reject) => {
        const existing = (window as any).SelfieSegmentation;
        if (existing) { resolve(existing); return; }
        const script = document.createElement('script');
        script.src = `${ASSET_BASE}selfie_segmentation.js`;
        script.async = true;
        script.onload = () => (window as any).SelfieSegmentation ? resolve((window as any).SelfieSegmentation) : reject(new Error('Background effects failed to load.'));
        script.onerror = () => { loader = null; reject(new Error('Background effects could not be downloaded.')); };
        document.head.append(script);
    });
    return loader;
}

export function drawPreset(ctx: CanvasRenderingContext2D, id: string, width: number, height: number) {
    const preset = BACKGROUND_PRESETS.find(p => p.id === id) ?? BACKGROUND_PRESETS[0];
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    preset.stops.forEach((stop, index) => gradient.addColorStop(index / (preset.stops.length - 1), stop));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    // Soft light shapes give depth without distracting.
    const glow = ctx.createRadialGradient(width * 0.75, height * 0.2, 0, width * 0.75, height * 0.2, width * 0.6);
    glow.addColorStop(0, 'rgba(255,255,255,0.18)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);
    if (preset.dots) {
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        for (let i = 0; i < 90; i++) { const x = (Math.sin(i * 12.9898) * 43758.5453 % 1 + 1) % 1, y = (Math.sin(i * 78.233) * 12345.678 % 1 + 1) % 1; ctx.fillRect(x * width, y * height * 0.8, 1.6, 1.6); }
    }
}

/**
 * Turns a camera track into a processed track with the chosen effect.
 * Call start() once, setEffect() to change, stop() when the camera stops.
 */
export class BackgroundProcessor {
    private segmenter: Segmenter | null = null;
    private video = document.createElement('video');
    private canvas = document.createElement('canvas');
    private ctx = this.canvas.getContext('2d')!;
    private small = document.createElement('canvas');
    private smallCtx = this.small.getContext('2d')!;
    private backdrop = document.createElement('canvas');
    private effect: BackgroundEffect = { kind: 'none' };
    private running = false;
    private timer = 0;
    private output: MediaStreamTrack | null = null;

    async start(source: MediaStreamTrack, effect: BackgroundEffect): Promise<MediaStreamTrack> {
        const Selfie = await loadMediaPipe();
        if (!this.segmenter) {
            const segmenter = new Selfie({ locateFile: file => `${ASSET_BASE}${file}` });
            segmenter.setOptions({ modelSelection: 1, selfieMode: false });
            segmenter.onResults(results => this.render(results.segmentationMask));
            await segmenter.initialize();
            this.segmenter = segmenter;
        }
        const { width = 1280, height = 720 } = source.getSettings();
        this.canvas.width = width; this.canvas.height = height;
        this.backdrop.width = width; this.backdrop.height = height;
        this.video.muted = true; this.video.playsInline = true;
        this.video.srcObject = new MediaStream([source]);
        await this.video.play();
        await this.setEffect(effect);
        this.running = true;
        this.loop();
        this.output = this.canvas.captureStream(24).getVideoTracks()[0];
        source.addEventListener('ended', () => this.stop(), { once: true });
        return this.output;
    }

    async setEffect(effect: BackgroundEffect) {
        this.effect = effect;
        if (effect.kind !== 'image') return;
        const { width, height } = this.backdrop;
        const ctx = this.backdrop.getContext('2d')!;
        if (effect.src) {
            const img = new Image();
            img.src = effect.src;
            await img.decode().catch(() => {});
            // Cover-fit the picture once; each frame just copies it.
            const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight) || 1;
            const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
            ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
        } else {
            drawPreset(ctx, effect.id, width, height);
        }
    }

    private loop = () => {
        if (!this.running || !this.segmenter) return;
        const next = () => { this.timer = window.setTimeout(this.loop, 1000 / 24); };
        if (this.video.readyState < 2) { next(); return; }
        this.segmenter.send({ image: this.video }).then(next, next);
    };

    private render(mask: CanvasImageSource) {
        const { width, height } = this.canvas;
        const ctx = this.ctx;
        ctx.save();
        ctx.clearRect(0, 0, width, height);
        if (this.effect.kind === 'none') { ctx.drawImage(this.video, 0, 0, width, height); ctx.restore(); return; }
        // Person: mask, then the camera frame inside it.
        ctx.drawImage(mask, 0, 0, width, height);
        ctx.globalCompositeOperation = 'source-in';
        ctx.drawImage(this.video, 0, 0, width, height);
        // Background behind the person.
        ctx.globalCompositeOperation = 'destination-over';
        if (this.effect.kind === 'blur') {
            // Downscale-then-upscale blur works in every browser (canvas filter is not universal).
            const factor = this.effect.strength === 'light' ? 0.12 : 0.05;
            this.small.width = Math.max(8, Math.round(width * factor));
            this.small.height = Math.max(8, Math.round(height * factor));
            this.smallCtx.imageSmoothingEnabled = true;
            this.smallCtx.drawImage(this.video, 0, 0, this.small.width, this.small.height);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(this.small, 0, 0, width, height);
        } else {
            ctx.drawImage(this.backdrop, 0, 0, width, height);
        }
        ctx.restore();
    }

    stop() {
        this.running = false;
        window.clearTimeout(this.timer);
        this.output?.stop();
        this.output = null;
        this.video.srcObject = null;
    }

    dispose() {
        this.stop();
        void this.segmenter?.close().catch(() => {});
        this.segmenter = null;
    }
}
