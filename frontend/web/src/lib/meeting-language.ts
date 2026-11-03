import { preferencesAllowed } from './storage-consent';
/**
 * Speaking language for a meeting participant (used for multilingual voice-to-text).
 *
 * Order of preference:
 *  1. the language the user picked before (saved on this device),
 *  2. the main language of the country the device is in, inferred from the
 *     device time zone and locale (no location permission prompt),
 *  3. the browser language, if it is in the supported list,
 *  4. English (US).
 *
 * The chosen code is announced with a `qsvc:speech-language` window event so a
 * speech-to-text engine can switch on the fly (SpeechToTextEngine.setLanguage).
 */
import { LANGUAGES, type LanguageInfo } from './realtime-translation';

/** Exact lookup (realtime-translation's getLanguage also matches by prefix). */
export function findLanguage(code: string): LanguageInfo | undefined {
    return LANGUAGES.find(l => l.code === code);
}

export type LanguageSource = 'saved' | 'location' | 'browser' | 'default';
export interface MeetingLanguage { code: string; source: LanguageSource; country?: string }

const STORAGE_KEY = 'qsvc:speech-language';
export const LANGUAGE_EVENT = 'qsvc:speech-language';

/** IANA time zone → ISO country (common zones; extend as needed). */
const ZONE_COUNTRY: Record<string, string> = {
    'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN',
    'Asia/Karachi': 'PK', 'Asia/Dhaka': 'BD', 'Asia/Kathmandu': 'NP', 'Asia/Katmandu': 'NP', 'Asia/Colombo': 'LK',
    'Asia/Shanghai': 'CN', 'Asia/Chongqing': 'CN', 'Asia/Urumqi': 'CN', 'Asia/Hong_Kong': 'HK', 'Asia/Taipei': 'TW',
    'Asia/Tokyo': 'JP', 'Asia/Seoul': 'KR', 'Asia/Bangkok': 'TH', 'Asia/Ho_Chi_Minh': 'VN', 'Asia/Saigon': 'VN',
    'Asia/Jakarta': 'ID', 'Asia/Makassar': 'ID', 'Asia/Jayapura': 'ID', 'Asia/Kuala_Lumpur': 'MY', 'Asia/Manila': 'PH',
    'Asia/Singapore': 'SG', 'Asia/Dubai': 'AE', 'Asia/Riyadh': 'SA', 'Asia/Qatar': 'QA', 'Asia/Kuwait': 'KW',
    'Asia/Bahrain': 'BH', 'Asia/Muscat': 'OM', 'Asia/Tehran': 'IR', 'Asia/Jerusalem': 'IL', 'Asia/Tel_Aviv': 'IL',
    'Europe/Istanbul': 'TR', 'Africa/Cairo': 'EG',
    'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Paris': 'FR', 'Europe/Berlin': 'DE', 'Europe/Madrid': 'ES',
    'Europe/Rome': 'IT', 'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE', 'Europe/Lisbon': 'PT', 'Europe/Warsaw': 'PL',
    'Europe/Prague': 'CZ', 'Europe/Bratislava': 'SK', 'Europe/Budapest': 'HU', 'Europe/Bucharest': 'RO', 'Europe/Sofia': 'BG',
    'Europe/Zagreb': 'HR', 'Europe/Athens': 'GR', 'Europe/Stockholm': 'SE', 'Europe/Copenhagen': 'DK', 'Europe/Oslo': 'NO',
    'Europe/Helsinki': 'FI', 'Europe/Kiev': 'UA', 'Europe/Kyiv': 'UA', 'Europe/Moscow': 'RU', 'Europe/Vienna': 'AT', 'Europe/Zurich': 'CH',
    'Africa/Nairobi': 'KE', 'Africa/Addis_Ababa': 'ET', 'Africa/Johannesburg': 'ZA', 'Africa/Lagos': 'NG', 'Africa/Dar_es_Salaam': 'TZ',
    'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Phoenix': 'US', 'America/Los_Angeles': 'US',
    'America/Anchorage': 'US', 'Pacific/Honolulu': 'US', 'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Mexico_City': 'MX',
    'America/Sao_Paulo': 'BR', 'America/Argentina/Buenos_Aires': 'AR', 'America/Bogota': 'CO', 'America/Lima': 'PE', 'America/Santiago': 'CL',
    'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Brisbane': 'AU', 'Australia/Perth': 'AU', 'Australia/Adelaide': 'AU',
    'Pacific/Auckland': 'NZ',
};

/** ISO country → main speaking language (codes from LANGUAGES). */
const COUNTRY_LANGUAGE: Record<string, string> = {
    IN: 'hi-IN', PK: 'ur-IN', BD: 'bn-IN', NP: 'ne-IN', LK: 'ta-IN',
    CN: 'zh-CN', HK: 'zh-TW', TW: 'zh-TW', JP: 'ja-JP', KR: 'ko-KR', TH: 'th-TH', VN: 'vi-VN', ID: 'id-ID', MY: 'ms-MY', PH: 'fil-PH', SG: 'en-GB',
    AE: 'ar-SA', SA: 'ar-SA', QA: 'ar-SA', KW: 'ar-SA', BH: 'ar-SA', OM: 'ar-SA', EG: 'ar-SA', IR: 'fa-IR', IL: 'he-IL', TR: 'tr-TR',
    GB: 'en-GB', IE: 'en-GB', FR: 'fr-FR', BE: 'fr-FR', DE: 'de-DE', AT: 'de-DE', CH: 'de-DE', ES: 'es-ES', IT: 'it-IT', NL: 'nl-NL', PT: 'pt-PT',
    PL: 'pl-PL', CZ: 'cs-CZ', SK: 'sk-SK', HU: 'hu-HU', RO: 'ro-RO', BG: 'bg-BG', HR: 'hr-HR', GR: 'el-GR', SE: 'sv-SE', DK: 'da-DK',
    NO: 'no-NO', FI: 'fi-FI', UA: 'uk-UA', RU: 'ru-RU',
    KE: 'sw-KE', TZ: 'sw-KE', ET: 'am-ET', ZA: 'en-GB', NG: 'en-GB',
    US: 'en-US', CA: 'en-US', MX: 'es-ES', AR: 'es-ES', CO: 'es-ES', PE: 'es-ES', CL: 'es-ES', BR: 'pt-BR', AU: 'en-GB', NZ: 'en-GB',
};

function safeStorage(): Storage | null {
    try { return preferencesAllowed() ? window.localStorage : null; } catch { return null; }
}

/** Country the device is in, from its time zone, else from the locale region (en-IN → IN). */
export function detectCountry(): string | undefined {
    try {
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (zone && ZONE_COUNTRY[zone]) return ZONE_COUNTRY[zone];
    } catch { /* ignore */ }
    for (const tag of navigator.languages ?? [navigator.language]) {
        const region = tag?.split('-')[1];
        if (region && region.length === 2) return region.toUpperCase();
    }
    return undefined;
}

/** Closest supported language for a browser tag like "hi", "en-IN" or "pt-BR". */
function matchSupported(tag: string): string | undefined {
    const exact = LANGUAGES.find(l => l.code.toLowerCase() === tag.toLowerCase());
    if (exact) return exact.code;
    const base = tag.split('-')[0].toLowerCase();
    return LANGUAGES.find(l => l.code.split('-')[0].toLowerCase() === base)?.code;
}

/** Language detected from location / browser only (ignores the saved choice). */
export function detectLanguage(): MeetingLanguage {
    const country = detectCountry();
    const fromCountry = country ? COUNTRY_LANGUAGE[country] : undefined;
    if (fromCountry && findLanguage(fromCountry)) return { code: fromCountry, source: 'location', country };
    for (const tag of navigator.languages ?? [navigator.language]) {
        const match = tag && matchSupported(tag);
        if (match) return { code: match, source: 'browser', country };
    }
    return { code: 'en-US', source: 'default', country };
}

/** Language to start a meeting with: saved choice first, then detection. */
export function initialMeetingLanguage(): MeetingLanguage {
    const saved = safeStorage()?.getItem(STORAGE_KEY);
    if (saved && findLanguage(saved)) return { code: saved, source: 'saved', country: detectCountry() };
    return detectLanguage();
}

/** Remember the user's choice on this device and tell any speech engine to switch. */
export function setMeetingLanguage(code: string): void {
    if (!findLanguage(code)) return;
    safeStorage()?.setItem(STORAGE_KEY, code);
    window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: { code } }));
}

/** Forget the saved choice so the next meeting follows location again. */
export function clearSavedLanguage(): void {
    safeStorage()?.removeItem(STORAGE_KEY);
}
