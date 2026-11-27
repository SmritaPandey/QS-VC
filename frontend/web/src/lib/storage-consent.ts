const KEY = 'qsvc:storage-consent:v2';
export const CAPTION_LANGUAGE_KEY = 'qsvc:caption-language';
export const CAPTION_VISIBILITY_KEY = 'qsvc:captions-visible';
export const LISTENING_LANGUAGE_KEY = 'qsvc:listening-language';
type CaptionPreference = typeof CAPTION_LANGUAGE_KEY | typeof CAPTION_VISIBILITY_KEY | typeof LISTENING_LANGUAGE_KEY;
const OPTIONAL = [CAPTION_LANGUAGE_KEY, CAPTION_VISIBILITY_KEY, LISTENING_LANGUAGE_KEY, 'qsvc:speech-language', 'qsvc:reaction-preferences', 'qsvc:ui-sounds', 'qsvc:theme'];
let memory: boolean | null = null;
export function readStorageConsent(): boolean | null {
    if (memory !== null) return memory;
    try {
        const value = localStorage.getItem(KEY);
        if (value === 'allow') return true;
        if (value === 'deny') return false;
    } catch { /* Browser storage may be unavailable. */ }
    return memory;
}
export function preferencesAllowed(): boolean { return readStorageConsent() === true; }
export function saveStorageConsent(allow: boolean) {
    memory = allow;
    try {
        localStorage.setItem(KEY, allow ? 'allow' : 'deny');
    } catch { /* Keep the choice in memory if storage is blocked. */ }
    if (!allow) OPTIONAL.forEach(key => { try { localStorage.removeItem(key); } catch { /* Storage may be blocked. */ } });
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('qsvc:storage-consent', { detail: allow }));
}

export function readCaptionPreference(key: CaptionPreference): string | null {
    try { return preferencesAllowed() ? localStorage.getItem(key) : null; } catch { return null; }
}

export function saveCaptionPreference(key: CaptionPreference, value: string): void {
    try { if (preferencesAllowed()) localStorage.setItem(key, value); } catch { /* Use the choice for this meeting. */ }
}
