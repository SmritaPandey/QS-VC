/**
 * Virtual background processor using MediaPipe SelfieSegmentation.
 * Applies blur, replacement image, or custom image to the video background
 * while preserving the foreground person.
 *
 * Falls back to a basic canvas-blur approach if MediaPipe is unavailable.
 */

export type BackgroundMode = 'none' | 'blur' | 'image' | 'color';

export interface VirtualBackgroundConfig {
    mode: BackgroundMode;
    blurAmount?: number;        // blur radius in px (default: 12)
    imageSrc?: string;          // URL of the replacement background image
    color?: string;             // solid background color (e.g. '#0a0a2e')
    edgeBlur?: number;          // feathering of the segmentation mask (default: 4)
}

export class VirtualBackgroundProcessor {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private videoElement: HTMLVideoElement;
    private animationId: number | null = null;
    private active: boolean = false;
    private processedStream: MediaStream | null = null;
    private config: VirtualBackgroundConfig;

    // Segmentation
    private selfieSegmentation: any = null;
    private segmentationReady: boolean = false;
    private latestMask: ImageBitmap | ImageData | null = null;

    // Background image
    private bgImage: HTMLImageElement | null = null;

    constructor(config?: Partial<VirtualBackgroundConfig>) {
        this.config = {
            mode: config?.mode || 'blur',
            blurAmount: config?.blurAmount ?? 12,
            edgeBlur: config?.edgeBlur ?? 4,
            imageSrc: config?.imageSrc,
            color: config?.color ?? '#0a0a2e',
        };
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d')!;
        this.videoElement = document.createElement('video');
        this.videoElement.playsInline = true;
        this.videoElement.muted = true;
    }

    /** Start processing a source video stream and return the processed stream. */
    async start(sourceStream: MediaStream): Promise<MediaStream> {
        const videoTrack = sourceStream.getVideoTracks()[0];
        if (!videoTrack) throw new Error('No video track in source stream');

        const settings = videoTrack.getSettings();
        this.canvas.width = settings.width || 640;
        this.canvas.height = settings.height || 480;

        this.videoElement.srcObject = sourceStream;
        await this.videoElement.play();

        // Try MediaPipe SelfieSegmentation
        await this.initSegmentation();

        // If a background image is specified, preload it
        if (this.config.imageSrc) {
            this.bgImage = await this.loadImage(this.config.imageSrc);
        }

        this.active = true;
        this.processFrame();

        // Capture the canvas as a MediaStream
        this.processedStream = this.canvas.captureStream(30);

        // Copy audio tracks from source
        for (const audioTrack of sourceStream.getAudioTracks()) {
            this.processedStream.addTrack(audioTrack);
        }

        return this.processedStream;
    }

    /** Initialize MediaPipe SelfieSegmentation via CDN. */
    private async initSegmentation(): Promise<void> {
        try {
            // @ts-ignore — dynamically loaded from CDN
            const { SelfieSegmentation } = await import(
                /* @vite-ignore */
                'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js'
            ).catch(() => (window as any));

            if (typeof SelfieSegmentation === 'function') {
                this.selfieSegmentation = new SelfieSegmentation({
                    locateFile: (file: string) =>
                        `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
                });
                this.selfieSegmentation.setOptions({ modelSelection: 1, selfieMode: true });
                this.selfieSegmentation.onResults((results: any) => {
                    if (results.segmentationMask) {
                        this.latestMask = results.segmentationMask;
                    }
                });
                // Warm-up
                await this.selfieSegmentation.initialize();
                this.segmentationReady = true;
                console.info('✅ MediaPipe SelfieSegmentation initialized');
            } else {
                throw new Error('SelfieSegmentation not found');
            }
        } catch (err) {
            console.warn('⚠️ MediaPipe not available, falling back to canvas blur:', err);
            this.segmentationReady = false;
        }
    }

    /** Process a single frame. */
    private processFrame(): void {
        if (!this.active) return;

        if (this.segmentationReady && this.selfieSegmentation) {
            // Send frame to MediaPipe
            this.selfieSegmentation.send({ image: this.videoElement }).then(() => {
                this.renderWithMask();
                this.animationId = requestAnimationFrame(() => this.processFrame());
            }).catch(() => {
                this.renderFallback();
                this.animationId = requestAnimationFrame(() => this.processFrame());
            });
        } else {
            this.renderFallback();
            this.animationId = requestAnimationFrame(() => this.processFrame());
        }
    }

    /** Render frame with segmentation mask (foreground/background separation). */
    private renderWithMask(): void {
        const { width, height } = this.canvas;
        const ctx = this.ctx;

        if (!this.latestMask) {
            this.renderFallback();
            return;
        }

        // Draw the segmentation mask
        ctx.save();
        ctx.clearRect(0, 0, width, height);

        // Draw the mask to a temporary canvas for compositing
        ctx.drawImage(this.latestMask as any, 0, 0, width, height);

        // Use the mask as a clip for the foreground
        ctx.globalCompositeOperation = 'source-in';
        ctx.drawImage(this.videoElement, 0, 0, width, height);

        // Draw background behind the person
        ctx.globalCompositeOperation = 'destination-over';

        switch (this.config.mode) {
            case 'blur':
                ctx.filter = `blur(${this.config.blurAmount}px)`;
                ctx.drawImage(this.videoElement, 0, 0, width, height);
                ctx.filter = 'none';
                break;

            case 'image':
                if (this.bgImage) {
                    ctx.drawImage(this.bgImage, 0, 0, width, height);
                }
                break;

            case 'color':
                ctx.fillStyle = this.config.color || '#0a0a2e';
                ctx.fillRect(0, 0, width, height);
                break;

            default:
                ctx.drawImage(this.videoElement, 0, 0, width, height);
        }

        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
    }

    /** Fallback rendering using center-weighted radial gradient (no ML). */
    private renderFallback(): void {
        const { width, height } = this.canvas;
        const ctx = this.ctx;

        // Draw with blur
        ctx.filter = `blur(${this.config.blurAmount}px)`;
        ctx.drawImage(this.videoElement, 0, 0, width, height);
        ctx.filter = 'none';

        // Draw the center portion unblurred (approximate person region)
        const centerW = width * 0.6;
        const centerH = height * 0.85;

        ctx.globalCompositeOperation = 'destination-out';
        const gradient = ctx.createRadialGradient(
            width / 2, height / 2, Math.min(centerW, centerH) * 0.3,
            width / 2, height / 2, Math.min(centerW, centerH) * 0.6
        );
        gradient.addColorStop(0, 'rgba(0,0,0,1)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'destination-over';

        ctx.drawImage(this.videoElement, 0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
    }

    /** Load an image URL and return an HTMLImageElement. */
    private loadImage(src: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }

    /** Stop processing and clean up. */
    stop(): void {
        this.active = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.videoElement.srcObject = null;
        if (this.selfieSegmentation) {
            this.selfieSegmentation.close?.();
            this.selfieSegmentation = null;
        }
        this.latestMask = null;
        this.processedStream = null;
    }

    /** Update background configuration on-the-fly. */
    setConfig(config: Partial<VirtualBackgroundConfig>): void {
        Object.assign(this.config, config);
        if (config.imageSrc && config.imageSrc !== this.bgImage?.src) {
            this.loadImage(config.imageSrc).then(img => { this.bgImage = img; });
        }
    }

    /** Set blur intensity. */
    setBlurAmount(amount: number): void {
        this.config.blurAmount = amount;
    }

    /** Check if processor is active. */
    isActive(): boolean {
        return this.active;
    }

    /** Get the processed stream. */
    getStream(): MediaStream | null {
        return this.processedStream;
    }

    /** Check if ML segmentation is available. */
    hasMLSegmentation(): boolean {
        return this.segmentationReady;
    }
}
