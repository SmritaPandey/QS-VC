/**
 * Speech-to-Text engine using the Web Speech API.
 * Provides real-time transcription for live captions.
 *
 * Falls back gracefully if SpeechRecognition is unavailable (Firefox, etc).
 */
import type { CaptionEntry } from '../components/CaptionOverlay';

export interface STTOptions {
    language?: string;          // BCP-47 language (default: 'en-US')
    continuous?: boolean;
    interimResults?: boolean;
    maxAlternatives?: number;
    onCaption?: (caption: CaptionEntry) => void;
    onError?: (error: string) => void;
}

let captionCounter = 0;

export class SpeechToTextEngine {
    private recognition: any = null;
    private active: boolean = false;
    private generation = 0;
    private options: STTOptions;
    private speakerName: string;

    constructor(speakerName: string, options?: STTOptions) {
        this.speakerName = speakerName;
        this.options = {
            language: options?.language || 'en-US',
            continuous: options?.continuous ?? true,
            interimResults: options?.interimResults ?? true,
            maxAlternatives: options?.maxAlternatives ?? 1,
            onCaption: options?.onCaption,
            onError: options?.onError,
        };
    }

    /** Check if Web Speech API is available in this browser. */
    static isSupported(): boolean {
        return typeof window !== 'undefined' && !!(
            (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        );
    }

    /** Start recognition; API availability does not guarantee a language or offline processing. */
    start(): void {
        if (this.active) return;
        if (!SpeechToTextEngine.isSupported()) {
            this.options.onError?.('Speech recognition not supported in this browser');
            return;
        }
        const generation = ++this.generation;
        const current = () => this.active && generation === this.generation;
        const utteranceIds = new Map<number, string>();
        try {
            const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
            const recognition = new SpeechRecognition();
            this.recognition = recognition;
            recognition.lang = this.options.language;
            recognition.continuous = this.options.continuous;
            recognition.interimResults = this.options.interimResults;
            recognition.maxAlternatives = this.options.maxAlternatives;
            recognition.onresult = (event: any) => {
                if (!current()) return;
                for (let i = event.resultIndex; i < event.results.length && current(); i++) {
                    const result = event.results[i];
                    const transcript = result[0]?.transcript?.trim();
                    if (!transcript) continue;
                    if (!utteranceIds.has(i)) utteranceIds.set(i, `stt-${++captionCounter}`);
                    this.options.onCaption?.({
                        id: utteranceIds.get(i)!, speakerName: this.speakerName,
                        text: transcript, isFinal: result.isFinal, timestamp: Date.now(),
                    });
                }
            };
            recognition.onerror = (event: any) => {
                if (!current() || event.error === 'no-speech') return;
                // Permission, service and network failures need an explicit user retry.
                this.stop();
                if (event.error !== 'aborted') this.options.onError?.(event.error === 'not-allowed' || event.error === 'service-not-allowed'
                    ? 'Allow microphone access to share captions.'
                    : 'Speech recognition stopped. Turn captions on again to retry.');
            };
            recognition.onend = () => {
                if (!current()) return;
                const restart = this.options.continuous;
                this.stop();
                if (restart) this.start();
            };
            this.active = true;
            recognition.start();
        } catch {
            this.stop();
            this.options.onError?.('Failed to start speech recognition');
        }
    }

    /** Discard pending results as well as releasing the browser recognizer. */
    stop(): void {
        this.active = false;
        ++this.generation;
        const recognition = this.recognition;
        this.recognition = null;
        if (!recognition) return;
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        try {
            if (typeof recognition.abort === 'function') recognition.abort();
            else recognition.stop();
        } catch { /* Already stopped. */ }
    }

    /** Check if the engine is active. */
    isActive(): boolean {
        return this.active;
    }

    /** Update speaker name (e.g., after authentication). */
    setSpeakerName(name: string): void {
        this.speakerName = name;
    }

    /** Change recognition language on-the-fly. */
    setLanguage(lang: string): void {
        this.options.language = lang;
        if (this.active) {
            this.stop();
            this.start();
        }
    }
}
