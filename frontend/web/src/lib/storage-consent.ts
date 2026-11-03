const KEY = 'qsvc:storage-consent:v2';
const OPTIONAL = ['qsvc:speech-language', 'qsvc:reaction-preferences', 'qsvc:ui-sounds'];
let memory: boolean | null = null;
export function readStorageConsent(): boolean | null {
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
        if (!allow) OPTIONAL.forEach(key => localStorage.removeItem(key));
    } catch { /* Keep the choice in memory if storage is blocked. */ }
}
