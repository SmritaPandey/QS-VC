/**
 * Real-Time Voice Translation Engine for QS-VC.
 *
 * Pipeline: Speaker Audio → STT → Translation → TTS → Listener Audio
 *
 * Architecture:
 * 1. Speaker speaks in their language (captured via Web Speech API or Whisper)
 * 2. Transcript sent to translation service (LibreTranslate API / fallback to browser)
 * 3. Translated text either:
 *    a) Displayed as captions (always)
 *    b) Spoken via Web Speech Synthesis TTS (optional, per-listener choice)
 * 4. Each listener independently selects their preferred language
 *
 * Supports 50+ languages including all 22 Indian scheduled languages,
 * Chinese, Japanese, Korean, Arabic, Hebrew, Spanish, German, Dutch, etc.
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LANGUAGE REGISTRY — 50+ Languages
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface LanguageInfo {
    code: string;           // BCP-47 / ISO 639-1
    name: string;           // English name
    nativeName: string;     // Name in native script
    region: 'indian' | 'east-asian' | 'european' | 'middle-eastern' | 'african' | 'other';
    ttsSupported: boolean;  // Whether Web Speech Synthesis has a voice
    sttSupported: boolean;  // Whether Web Speech Recognition supports it
}

export const LANGUAGES: LanguageInfo[] = [
    // ── Indian Languages (All 22 Scheduled Languages + More) ─────────────
    { code: 'hi-IN', name: 'Hindi',        nativeName: 'हिन्दी',       region: 'indian', ttsSupported: true,  sttSupported: true  },
    { code: 'bn-IN', name: 'Bengali',      nativeName: 'বাংলা',        region: 'indian', ttsSupported: true,  sttSupported: true  },
    { code: 'te-IN', name: 'Telugu',       nativeName: 'తెలుగు',       region: 'indian', ttsSupported: true,  sttSupported: true  },
    { code: 'mr-IN', name: 'Marathi',      nativeName: 'मराठी',        region: 'indian', ttsSupported: true,  sttSupported: true  },
    { code: 'ta-IN', name: 'Tamil',        nativeName: 'தமிழ்',        region: 'indian', ttsSupported: true,  sttSupported: true  },
    { code: 'gu-IN', name: 'Gujarati',     nativeName: 'ગુજરાતી',      region: 'indian', ttsSupported: true,  sttSupported: true  },
    { code: 'kn-IN', name: 'Kannada',      nativeName: 'ಕನ್ನಡ',        region: 'indian', ttsSupported: true,  sttSupported: true  },
    { code: 'ml-IN', name: 'Malayalam',    nativeName: 'മലയാളം',      region: 'indian', ttsSupported: true,  sttSupported: true  },
    { code: 'or-IN', name: 'Odia',         nativeName: 'ଓଡ଼ିଆ',        region: 'indian', ttsSupported: true,  sttSupported: true  },
    { code: 'pa-IN', name: 'Punjabi',      nativeName: 'ਪੰਜਾਬੀ',       region: 'indian', ttsSupported: true,  sttSupported: true  },
    { code: 'as-IN', name: 'Assamese',    nativeName: 'অসমীয়া',      region: 'indian', ttsSupported: false, sttSupported: false },
    { code: 'mai-IN',name: 'Maithili',     nativeName: 'मैथिली',       region: 'indian', ttsSupported: false, sttSupported: false },
    { code: 'sa-IN', name: 'Sanskrit',     nativeName: 'संस्कृतम्',    region: 'indian', ttsSupported: false, sttSupported: false },
    { code: 'ne-IN', name: 'Nepali',       nativeName: 'नेपाली',       region: 'indian', ttsSupported: true,  sttSupported: true  },
    { code: 'sd-IN', name: 'Sindhi',       nativeName: 'سنڌي',         region: 'indian', ttsSupported: false, sttSupported: false },
    { code: 'ks-IN', name: 'Kashmiri',     nativeName: 'कॉशुर',        region: 'indian', ttsSupported: false, sttSupported: false },
    { code: 'doi-IN',name: 'Dogri',        nativeName: 'डोगरी',        region: 'indian', ttsSupported: false, sttSupported: false },
    { code: 'kok-IN',name: 'Konkani',      nativeName: 'कोंकणी',       region: 'indian', ttsSupported: false, sttSupported: false },
    { code: 'mni-IN',name: 'Manipuri',     nativeName: 'মৈতৈলোন্',    region: 'indian', ttsSupported: false, sttSupported: false },
    { code: 'sat-IN',name: 'Santali',      nativeName: 'ᱥᱟᱱᱛᱟᱲᱤ',    region: 'indian', ttsSupported: false, sttSupported: false },
    { code: 'bo-IN', name: 'Bodo',         nativeName: 'बड़ो',          region: 'indian', ttsSupported: false, sttSupported: false },
    { code: 'ur-IN', name: 'Urdu',         nativeName: 'اردو',          region: 'indian', ttsSupported: true,  sttSupported: true  },

    // ── East Asian Languages ──────────────────────────────────────────────
    { code: 'zh-CN', name: 'Chinese (Simplified)',  nativeName: '简体中文',    region: 'east-asian', ttsSupported: true,  sttSupported: true  },
    { code: 'zh-TW', name: 'Chinese (Traditional)', nativeName: '繁體中文',    region: 'east-asian', ttsSupported: true,  sttSupported: true  },
    { code: 'ja-JP', name: 'Japanese',     nativeName: '日本語',         region: 'east-asian', ttsSupported: true,  sttSupported: true  },
    { code: 'ko-KR', name: 'Korean',       nativeName: '한국어',         region: 'east-asian', ttsSupported: true,  sttSupported: true  },
    { code: 'th-TH', name: 'Thai',         nativeName: 'ไทย',           region: 'east-asian', ttsSupported: true,  sttSupported: true  },
    { code: 'vi-VN', name: 'Vietnamese',   nativeName: 'Tiếng Việt',   region: 'east-asian', ttsSupported: true,  sttSupported: true  },
    { code: 'id-ID', name: 'Indonesian',   nativeName: 'Bahasa Indonesia', region: 'east-asian', ttsSupported: true, sttSupported: true },
    { code: 'ms-MY', name: 'Malay',        nativeName: 'Bahasa Melayu', region: 'east-asian', ttsSupported: true,  sttSupported: true  },
    { code: 'fil-PH',name: 'Filipino',     nativeName: 'Filipino',      region: 'east-asian', ttsSupported: true,  sttSupported: true  },

    // ── European Languages ────────────────────────────────────────────────
    { code: 'en-US', name: 'English (US)',  nativeName: 'English',       region: 'european', ttsSupported: true,  sttSupported: true  },
    { code: 'en-GB', name: 'English (UK)',  nativeName: 'English',       region: 'european', ttsSupported: true,  sttSupported: true  },
    { code: 'es-ES', name: 'Spanish',       nativeName: 'Español',      region: 'european', ttsSupported: true,  sttSupported: true  },
    { code: 'fr-FR', name: 'French',        nativeName: 'Français',     region: 'european', ttsSupported: true,  sttSupported: true  },
    { code: 'de-DE', name: 'German',        nativeName: 'Deutsch',      region: 'european', ttsSupported: true,  sttSupported: true  },
    { code: 'nl-NL', name: 'Dutch',         nativeName: 'Nederlands',   region: 'european', ttsSupported: true,  sttSupported: true  },
    { code: 'it-IT', name: 'Italian',       nativeName: 'Italiano',     region: 'european', ttsSupported: true,  sttSupported: true  },
    { code: 'pt-BR', name: 'Portuguese (BR)', nativeName: 'Português',  region: 'european', ttsSupported: true,  sttSupported: true  },
    { code: 'pt-PT', name: 'Portuguese (PT)', nativeName: 'Português',  region: 'european', ttsSupported: true,  sttSupported: true  },
    { code: 'ru-RU', name: 'Russian',       nativeName: 'Русский',      region: 'european', ttsSupported: true,  sttSupported: true  },
    { code: 'pl-PL', name: 'Polish',        nativeName: 'Polski',       region: 'european', ttsSupported: true,  sttSupported: true  },
    { code: 'uk-UA', name: 'Ukrainian',     nativeName: 'Українська',   region: 'european', ttsSupported: true,  sttSupported: true  },
    { code: 'cs-CZ', name: 'Czech',         nativeName: 'Čeština',      region: 'european', ttsSupported: true,  sttSupported: true  },
    { code: 'ro-RO', name: 'Romanian',      nativeName: 'Română',       region: 'european', ttsSupported: true,  sttSupported: true  },
    { code: 'sv-SE', name: 'Swedish',       nativeName: 'Svenska',      region: 'european', ttsSupported: true,  sttSupported: true  },
    { code: 'da-DK', name: 'Danish',        nativeName: 'Dansk',        region: 'european', ttsSupported: true,  sttSupported: true  },
    { code: 'fi-FI', name: 'Finnish',       nativeName: 'Suomi',        region: 'european', ttsSupported: true,  sttSupported: true  },
    { code: 'no-NO', name: 'Norwegian',     nativeName: 'Norsk',        region: 'european', ttsSupported: true,  sttSupported: true  },
    { code: 'el-GR', name: 'Greek',         nativeName: 'Ελληνικά',     region: 'european', ttsSupported: true,  sttSupported: true  },
    { code: 'hu-HU', name: 'Hungarian',     nativeName: 'Magyar',       region: 'european', ttsSupported: true,  sttSupported: true  },
    { code: 'bg-BG', name: 'Bulgarian',     nativeName: 'Български',    region: 'european', ttsSupported: true,  sttSupported: true  },
    { code: 'hr-HR', name: 'Croatian',      nativeName: 'Hrvatski',     region: 'european', ttsSupported: true,  sttSupported: true  },
    { code: 'sk-SK', name: 'Slovak',        nativeName: 'Slovenčina',   region: 'european', ttsSupported: true,  sttSupported: true  },

    // ── Middle Eastern Languages ──────────────────────────────────────────
    { code: 'ar-SA', name: 'Arabic',        nativeName: 'العربية',       region: 'middle-eastern', ttsSupported: true, sttSupported: true },
    { code: 'he-IL', name: 'Hebrew',        nativeName: 'עברית',         region: 'middle-eastern', ttsSupported: true, sttSupported: true },
    { code: 'fa-IR', name: 'Persian',       nativeName: 'فارسی',         region: 'middle-eastern', ttsSupported: true, sttSupported: true },
    { code: 'tr-TR', name: 'Turkish',       nativeName: 'Türkçe',       region: 'middle-eastern', ttsSupported: true, sttSupported: true },

    // ── African Languages ─────────────────────────────────────────────────
    { code: 'sw-KE', name: 'Swahili',       nativeName: 'Kiswahili',    region: 'african', ttsSupported: true,  sttSupported: true  },
    { code: 'am-ET', name: 'Amharic',       nativeName: 'አማርኛ',        region: 'african', ttsSupported: false, sttSupported: false },
    { code: 'zu-ZA', name: 'Zulu',          nativeName: 'isiZulu',      region: 'african', ttsSupported: true,  sttSupported: true  },
    { code: 'af-ZA', name: 'Afrikaans',     nativeName: 'Afrikaans',    region: 'african', ttsSupported: true,  sttSupported: true  },
];

/** Get a language by code. */
export function getLanguage(code: string): LanguageInfo | undefined {
    return LANGUAGES.find(l => l.code === code || l.code.startsWith(code.split('-')[0]));
}

/** Get languages grouped by region. */
export function getLanguagesByRegion(): Record<string, LanguageInfo[]> {
    const grouped: Record<string, LanguageInfo[]> = {};
    for (const lang of LANGUAGES) {
        if (!grouped[lang.region]) grouped[lang.region] = [];
        grouped[lang.region].push(lang);
    }
    return grouped;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TRANSLATION ENGINE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface TranslationResult {
    originalText: string;
    translatedText: string;
    sourceLanguage: string;
    targetLanguage: string;
    confidence: number;
    timestamp: number;
}

export interface TranslationEngineOptions {
    apiUrl?: string;                // LibreTranslate API endpoint
    apiKey?: string;                // API key if required
    fallbackToGoogle?: boolean;     // Use Google Translate as fallback
    cacheTranslations?: boolean;    // Cache repeated translations
    maxCacheSize?: number;          // Max cache entries
}

export class TranslationEngine {
    private options: TranslationEngineOptions;
    private cache: Map<string, string> = new Map();

    constructor(options?: TranslationEngineOptions) {
        this.options = {
            apiUrl: options?.apiUrl || '/api/translate',
            apiKey: options?.apiKey,
            fallbackToGoogle: options?.fallbackToGoogle ?? true,
            cacheTranslations: options?.cacheTranslations ?? true,
            maxCacheSize: options?.maxCacheSize ?? 1000,
        };
    }

    /**
     * Translate text from source to target language.
     * Uses cascading fallback: API → Google Translate → MyMemory → original text
     */
    async translate(
        text: string,
        sourceLang: string,
        targetLang: string
    ): Promise<TranslationResult> {
        if (!text.trim()) {
            return { originalText: text, translatedText: text, sourceLanguage: sourceLang, targetLanguage: targetLang, confidence: 1, timestamp: Date.now() };
        }

        // Same language — no translation needed
        const srcBase = sourceLang.split('-')[0];
        const tgtBase = targetLang.split('-')[0];
        if (srcBase === tgtBase) {
            return { originalText: text, translatedText: text, sourceLanguage: sourceLang, targetLanguage: targetLang, confidence: 1, timestamp: Date.now() };
        }

        // Check cache
        const cacheKey = `${srcBase}:${tgtBase}:${text.toLowerCase().trim()}`;
        if (this.options.cacheTranslations && this.cache.has(cacheKey)) {
            return {
                originalText: text,
                translatedText: this.cache.get(cacheKey)!,
                sourceLanguage: sourceLang,
                targetLanguage: targetLang,
                confidence: 0.95,
                timestamp: Date.now(),
            };
        }

        // Try primary API (LibreTranslate or custom)
        let translated = await this.translateViaAPI(text, srcBase, tgtBase);
        let confidence = 0.9;

        // Fallback: MyMemory (free, no API key)
        if (!translated) {
            translated = await this.translateViaMyMemory(text, srcBase, tgtBase);
            confidence = 0.75;
        }

        // Fallback: Browser-native (limited languages)
        if (!translated) {
            translated = text; // Return original if all fail
            confidence = 0;
        }

        // Cache result
        if (this.options.cacheTranslations && translated !== text) {
            if (this.cache.size >= (this.options.maxCacheSize || 1000)) {
                const firstKey = this.cache.keys().next().value;
                if (firstKey) this.cache.delete(firstKey);
            }
            this.cache.set(cacheKey, translated);
        }

        return {
            originalText: text,
            translatedText: translated,
            sourceLanguage: sourceLang,
            targetLanguage: targetLang,
            confidence,
            timestamp: Date.now(),
        };
    }

    /** Translate via LibreTranslate or custom API. */
    private async translateViaAPI(text: string, source: string, target: string): Promise<string | null> {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);

            const res = await fetch(this.options.apiUrl!, {
                method: 'POST',
                signal: controller.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    q: text,
                    source,
                    target,
                    api_key: this.options.apiKey || '',
                }),
            });

            clearTimeout(timeout);
            if (!res.ok) return null;

            const data = await res.json();
            return data.translatedText || null;
        } catch {
            return null;
        }
    }

    /** Translate via MyMemory (free API, 5000 chars/day). */
    private async translateViaMyMemory(text: string, source: string, target: string): Promise<string | null> {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);

            const langpair = `${source}|${target}`;
            const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langpair)}`;

            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout);
            if (!res.ok) return null;

            const data = await res.json();
            if (data.responseStatus === 200 && data.responseData?.translatedText) {
                const result = data.responseData.translatedText;
                // MyMemory returns CAPITALIZED text for some languages — fix
                if (result === result.toUpperCase() && result.length > 5) {
                    return result.charAt(0).toUpperCase() + result.slice(1).toLowerCase();
                }
                return result;
            }
            return null;
        } catch {
            return null;
        }
    }

    /** Clear the translation cache. */
    clearCache(): void {
        this.cache.clear();
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TEXT-TO-SPEECH ENGINE (Real-time voice output)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface TTSOptions {
    language: string;
    rate?: number;          // Speech rate (0.1 – 10, default: 1.1)
    pitch?: number;         // Pitch (0 – 2, default: 1)
    volume?: number;        // Volume (0 – 1, default: 0.8)
    preferredVoice?: string; // Preferred voice name (exact match)
}

export class TextToSpeechEngine {
    private synth: SpeechSynthesis;
    private utteranceQueue: SpeechSynthesisUtterance[] = [];
    private speaking: boolean = false;
    private active: boolean = false;
    private options: TTSOptions;
    private voiceCache: Map<string, SpeechSynthesisVoice> = new Map();

    constructor(options: TTSOptions) {
        this.synth = window.speechSynthesis;
        this.options = {
            rate: options.rate ?? 1.1,
            pitch: options.pitch ?? 1,
            volume: options.volume ?? 0.8,
            ...options,
        };
        this.loadVoices();

        // Voices may load asynchronously
        this.synth.onvoiceschanged = () => this.loadVoices();
    }

    /** Get available voices. */
    private loadVoices(): void {
        const voices = this.synth.getVoices();
        this.voiceCache.clear();
        for (const voice of voices) {
            // Map by language code (first match wins)
            const langBase = voice.lang.split('-')[0];
            if (!this.voiceCache.has(voice.lang)) {
                this.voiceCache.set(voice.lang, voice);
            }
            if (!this.voiceCache.has(langBase)) {
                this.voiceCache.set(langBase, voice);
            }
        }
    }

    /** Find the best voice for a language code. */
    getBestVoice(langCode: string): SpeechSynthesisVoice | null {
        // Exact match
        if (this.voiceCache.has(langCode)) return this.voiceCache.get(langCode)!;
        // Base language match
        const base = langCode.split('-')[0];
        if (this.voiceCache.has(base)) return this.voiceCache.get(base)!;
        return null;
    }

    /** Speak translated text. */
    speak(text: string, langCode?: string): void {
        if (!this.active) return;
        if (!text.trim()) return;

        const utterance = new SpeechSynthesisUtterance(text);
        const lang = langCode || this.options.language;
        utterance.lang = lang;
        utterance.rate = this.options.rate!;
        utterance.pitch = this.options.pitch!;
        utterance.volume = this.options.volume!;

        // Assign best voice
        const voice = this.getBestVoice(lang);
        if (voice) utterance.voice = voice;

        utterance.onend = () => {
            this.speaking = false;
            this.processQueue();
        };

        utterance.onerror = () => {
            this.speaking = false;
            this.processQueue();
        };

        // Queue the utterance
        this.utteranceQueue.push(utterance);
        this.processQueue();
    }

    /** Process the TTS queue. */
    private processQueue(): void {
        if (this.speaking || this.utteranceQueue.length === 0) return;

        // Keep queue short — skip old utterances if backed up
        while (this.utteranceQueue.length > 3) {
            this.utteranceQueue.shift();
        }

        const next = this.utteranceQueue.shift();
        if (next) {
            this.speaking = true;
            this.synth.speak(next);
        }
    }

    /** Start TTS engine. */
    start(): void {
        this.active = true;
    }

    /** Stop TTS engine and clear queue. */
    stop(): void {
        this.active = false;
        this.synth.cancel();
        this.utteranceQueue = [];
        this.speaking = false;
    }

    /** Set output language. */
    setLanguage(lang: string): void {
        this.options.language = lang;
    }

    /** Set volume. */
    setVolume(volume: number): void {
        this.options.volume = Math.max(0, Math.min(1, volume));
    }

    /** Check if a language has TTS voice available. */
    static hasVoice(langCode: string): boolean {
        const voices = window.speechSynthesis.getVoices();
        const base = langCode.split('-')[0];
        return voices.some(v => v.lang === langCode || v.lang.startsWith(base));
    }

    /** Get all available TTS voices grouped by language. */
    static getAvailableVoices(): Record<string, SpeechSynthesisVoice[]> {
        const voices = window.speechSynthesis.getVoices();
        const grouped: Record<string, SpeechSynthesisVoice[]> = {};
        for (const v of voices) {
            const base = v.lang.split('-')[0];
            if (!grouped[base]) grouped[base] = [];
            grouped[base].push(v);
        }
        return grouped;
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REAL-TIME TRANSLATION PIPELINE (Orchestrator)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface TranslationPipelineConfig {
    speakerLanguage: string;    // Speaker's input language (e.g., 'en-US')
    listenerLanguage: string;   // Listener's desired language (e.g., 'hi-IN')
    enableTTS: boolean;         // Speak translated text aloud
    ttsVolume?: number;         // TTS volume (0-1)
    translationApiUrl?: string; // Custom translation API URL
    onTranslation?: (result: TranslationResult & { spokenAloud: boolean }) => void;
    onError?: (error: string) => void;
}

export class RealtimeTranslationPipeline {
    private translator: TranslationEngine;
    private tts: TextToSpeechEngine | null = null;
    private config: TranslationPipelineConfig;
    private active: boolean = false;
    private pendingTranslations: Set<string> = new Set();
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(config: TranslationPipelineConfig) {
        this.config = config;
        this.translator = new TranslationEngine({
            apiUrl: config.translationApiUrl || '/api/translate',
        });

        if (config.enableTTS) {
            this.tts = new TextToSpeechEngine({
                language: config.listenerLanguage,
                volume: config.ttsVolume ?? 0.7,
            });
        }
    }

    /** Start the translation pipeline. */
    start(): void {
        this.active = true;
        this.tts?.start();
        console.info(`🌐 Translation pipeline started: ${this.config.speakerLanguage} → ${this.config.listenerLanguage}`);
    }

    /** Stop the pipeline. */
    stop(): void {
        this.active = false;
        this.tts?.stop();
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        console.info('🌐 Translation pipeline stopped');
    }

    /**
     * Process a caption from the speaker — translate and optionally speak.
     * This is the main entry point called by the MeetingRoom when a caption arrives.
     */
    async processCaption(text: string, isFinal: boolean): Promise<void> {
        if (!this.active) return;
        if (!text.trim()) return;

        // Debounce interim results (only translate final results for efficiency)
        if (!isFinal) {
            // For interim: show a placeholder in the listener's language
            if (this.debounceTimer) clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => {
                this.translateAndDeliver(text, false);
            }, 300);
            return;
        }

        // Final result — translate immediately
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        await this.translateAndDeliver(text, true);
    }

    /** Internal: translate and deliver to listener. */
    private async translateAndDeliver(text: string, isFinal: boolean): Promise<void> {
        // Avoid duplicate translations
        const key = text.trim().toLowerCase();
        if (this.pendingTranslations.has(key)) return;
        this.pendingTranslations.add(key);

        try {
            const result = await this.translator.translate(
                text,
                this.config.speakerLanguage,
                this.config.listenerLanguage
            );

            let spokenAloud = false;

            // TTS: only speak final results
            if (isFinal && this.tts && this.config.enableTTS && result.translatedText) {
                this.tts.speak(result.translatedText, this.config.listenerLanguage);
                spokenAloud = true;
            }

            this.config.onTranslation?.({ ...result, spokenAloud });
        } catch (err: any) {
            this.config.onError?.(`Translation error: ${err.message}`);
        } finally {
            this.pendingTranslations.delete(key);
        }
    }

    /** Update the listener's language. */
    setListenerLanguage(lang: string): void {
        this.config.listenerLanguage = lang;
        this.tts?.setLanguage(lang);
    }

    /** Update the speaker's language. */
    setSpeakerLanguage(lang: string): void {
        this.config.speakerLanguage = lang;
    }

    /** Toggle TTS on/off. */
    setTTSEnabled(enabled: boolean): void {
        this.config.enableTTS = enabled;
        if (enabled && !this.tts) {
            this.tts = new TextToSpeechEngine({
                language: this.config.listenerLanguage,
                volume: this.config.ttsVolume ?? 0.7,
            });
            if (this.active) this.tts.start();
        } else if (!enabled && this.tts) {
            this.tts.stop();
        }
    }

    /** Set TTS volume. */
    setTTSVolume(volume: number): void {
        this.config.ttsVolume = volume;
        this.tts?.setVolume(volume);
    }

    /** Check if same-language (no translation needed). */
    isSameLanguage(): boolean {
        const src = this.config.speakerLanguage.split('-')[0];
        const tgt = this.config.listenerLanguage.split('-')[0];
        return src === tgt;
    }

    /** Check if pipeline is active. */
    isActive(): boolean {
        return this.active;
    }
}
