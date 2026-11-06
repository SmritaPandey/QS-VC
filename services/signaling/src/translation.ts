/** Official Cloud Translation Basic v2; credentials and requests stay on the server. */
const ENDPOINT = 'https://translation.googleapis.com/language/translate/v2';
const CODE = /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/;
/** Google keeps the region/script for these; everything else uses the base language. */
const KEEP_REGION = new Set(['zh-CN', 'zh-TW', 'mni-Mtei', 'pt-PT']);
const GOOGLE_ALIASES: Record<string, string> = { 'mni-IN': 'mni-Mtei', 'kok-IN': 'gom', kok: 'gom', 'fil-PH': 'tl', fil: 'tl', 'he-IL': 'iw', he: 'iw' };
/** Used only if the live language list cannot be fetched. All are documented Google v2 languages. */
const FALLBACK = ['en', 'hi', 'bn', 'te', 'mr', 'ta', 'gu', 'kn', 'ml', 'or', 'pa', 'as', 'ur', 'ne', 'sa', 'mai', 'doi', 'gom', 'sd', 'ja', 'zh-CN', 'zh-TW', 'ko', 'ar', 'fr', 'de', 'es', 'ru', 'pt'];

export type GoogleLanguage = { code: string; name: string };
let languageCache: { expires: number; languages: GoogleLanguage[] } | undefined;
let languagePending: Promise<GoogleLanguage[]> | undefined;

/** Normalise a BCP-47 tag to the Google code. Throws for malformed tags. */
export function translationLanguage(code: string): string {
    if (typeof code !== 'string' || !CODE.test(code)) throw new Error('Unsupported translation language');
    if (Object.hasOwn(GOOGLE_ALIASES, code)) return GOOGLE_ALIASES[code];
    if (KEEP_REGION.has(code)) return code;
    const base = code.split('-')[0];
    return Object.hasOwn(GOOGLE_ALIASES, base) ? GOOGLE_ALIASES[base] : base;
}

function apiKey(): string {
    const key = process.env.GOOGLE_TRANSLATE_API_KEY?.trim();
    if (!key) throw new Error('Translation unavailable: provider is not configured');
    return key;
}

/** Live list of languages this key can translate (cached for 6 h). Falls back to a fixed list on failure. */
export async function googleLanguages(): Promise<GoogleLanguage[]> {
    if (languageCache && languageCache.expires > Date.now()) return languageCache.languages;
    if (languagePending) return languagePending;
    const key = apiKey();
    languagePending = (async () => {
        try {
            const response = await fetch(`${ENDPOINT}/languages?target=en`, { headers: { 'X-Goog-Api-Key': key }, signal: AbortSignal.timeout(5000), redirect: 'error' });
            if (!response.ok) throw new Error();
            const body = await response.json() as { data?: { languages?: { language?: unknown; name?: unknown }[] } };
            const languages = (body?.data?.languages || [])
                .filter(item => typeof item.language === 'string' && CODE.test(item.language) || item.language === 'mni-Mtei')
                .slice(0, 250)
                .map(item => ({ code: String(item.language), name: typeof item.name === 'string' ? item.name.slice(0, 100) : String(item.language) }));
            if (!languages.length) throw new Error();
            languageCache = { expires: Date.now() + 6 * 3600_000, languages };
        } catch {
            languageCache = { expires: Date.now() + 300_000, languages: FALLBACK.map(code => ({ code, name: code })) };
        }
        return languageCache.languages;
    })().finally(() => { languagePending = undefined; });
    return languagePending;
}

/** Test hook. */
export function resetGoogleLanguageCache() { languageCache = undefined; languagePending = undefined; }

export async function translateText(text: string, sourceLanguage: string, targetLanguage: string, supported?: GoogleLanguage[]): Promise<{
    translatedText: string; sourceLanguage: string; targetLanguage: string;
}> {
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('Text must contain 1–2000 characters');
    const source = translationLanguage(sourceLanguage);
    const target = translationLanguage(targetLanguage);
    if (source === target) return { translatedText: text, sourceLanguage, targetLanguage };
    if (supported && (!supported.some(item => item.code === source) || !supported.some(item => item.code === target))) throw new Error('Unsupported translation language');
    const key = apiKey();
    try {
        const response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
            body: JSON.stringify({ q: text, source, target, format: 'text' }),
            signal: AbortSignal.timeout(5000),
            redirect: 'error',
        });
        if (!response.ok) throw new Error('Provider rejected request');
        const result = await response.json() as { data?: { translations?: { translatedText?: unknown }[] } };
        const translatedText = result?.data?.translations?.[0]?.translatedText;
        if (typeof translatedText !== 'string' || !translatedText.trim() || translatedText.length > 16000) {
            throw new Error('Invalid provider result');
        }
        return { translatedText, sourceLanguage, targetLanguage };
    } catch {
        // Do not expose upstream errors, which may contain submitted text or credentials.
        throw new Error('Translation unavailable: provider request failed');
    }
}
