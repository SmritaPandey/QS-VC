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
        return !!(
            (window as any).SpeechRecognition ||
            (window as any).webkitSpeechRecognition
        );
    }

    /** Start speech recognition. */
    start(): void {
        if (this.active) return;

        const SpeechRecognition =
            (window as any).SpeechRecognition ||
            (window as any).webkitSpeechRecognition;

        if (!SpeechRecognition) {
            this.options.onError?.('Speech recognition not supported in this browser');
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.lang = this.options.language;
        this.recognition.continuous = this.options.continuous;
        this.recognition.interimResults = this.options.interimResults;
        this.recognition.maxAlternatives = this.options.maxAlternatives;

        this.recognition.onresult = (event: any) => {
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                const transcript = result[0].transcript.trim();
                if (!transcript) continue;

                const caption: CaptionEntry = {
                    id: `stt-${++captionCounter}`,
                    speakerName: this.speakerName,
                    text: transcript,
                    isFinal: result.isFinal,
                    timestamp: Date.now(),
                };

                this.options.onCaption?.(caption);
            }
        };

        this.recognition.onerror = (event: any) => {
            const errorMsg = event.error === 'no-speech'
                ? 'No speech detected'
                : `Speech recognition error: ${event.error}`;

            if (event.error !== 'no-speech' && event.error !== 'aborted') {
                this.options.onError?.(errorMsg);
            }
        };

        this.recognition.onend = () => {
            // Auto-restart if still active (continuous mode)
            if (this.active) {
                try {
                    this.recognition.start();
                } catch {
                    // May throw if already started
                }
            }
        };

        try {
            this.recognition.start();
            this.active = true;
            console.info('🎙️ Speech-to-text started');
        } catch (err) {
            this.options.onError?.('Failed to start speech recognition');
        }
    }

    /** Stop speech recognition. */
    stop(): void {
        this.active = false;
        if (this.recognition) {
            try {
                this.recognition.stop();
            } catch {
                // May throw if already stopped
            }
            this.recognition = null;
        }
        console.info('🎙️ Speech-to-text stopped');
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
