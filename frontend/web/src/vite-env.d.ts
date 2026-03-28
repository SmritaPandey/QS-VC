/// <reference types="vite/client" />

// MediaPipe CDN dynamic import declaration
declare module 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js' {
    export class SelfieSegmentation {
        constructor(config: { locateFile: (file: string) => string });
        setOptions(options: any): void;
        onResults(callback: (results: any) => void): void;
        initialize(): Promise<void>;
        send(input: { image: HTMLVideoElement }): Promise<void>;
        close(): void;
    }
}
