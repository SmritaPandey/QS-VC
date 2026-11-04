/** Official Cloud Translation Basic v2; credentials and requests stay on the server. */
const ENDPOINT = 'https://translation.googleapis.com/language/translate/v2';
const LANGUAGES: Record<string, string> = { en: 'en', 'en-US': 'en', 'en-GB': 'en', hi: 'hi', 'hi-IN': 'hi', ja: 'ja', 'ja-JP': 'ja' };

export function translationLanguage(code: string): string {
    const language = Object.hasOwn(LANGUAGES, code) ? LANGUAGES[code] : undefined;
    if (!language) throw new Error('Unsupported translation language');
    return language;
}

export async function translateText(text: string, sourceLanguage: string, targetLanguage: string): Promise<{
    translatedText: string; sourceLanguage: string; targetLanguage: string;
}> {
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('Text must contain 1–2000 characters');
    const source = translationLanguage(sourceLanguage);
    const target = translationLanguage(targetLanguage);
    if (source === target) return { translatedText: text, sourceLanguage, targetLanguage };
    const key = process.env.GOOGLE_TRANSLATE_API_KEY?.trim();
    if (!key) throw new Error('Translation unavailable: provider is not configured');
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
