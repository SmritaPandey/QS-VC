import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateText, translationLanguage } from './translation';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('Google Cloud Translation adapter', () => {
    it('uses the official endpoint with server credentials and plain text; returns no invented confidence', async () => {
        vi.stubEnv('GOOGLE_TRANSLATE_API_KEY', 'test-secret');
        const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { translations: [{ translatedText: 'नमस्ते' }] } }) });
        vi.stubGlobal('fetch', request);
        const result = await translateText('Hello', 'en-US', 'hi-IN');
        expect(result).toEqual({ translatedText: 'नमस्ते', sourceLanguage: 'en-US', targetLanguage: 'hi-IN' });
        expect(request).toHaveBeenCalledWith('https://translation.googleapis.com/language/translate/v2', expect.objectContaining({
            method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': 'test-secret' },
            body: JSON.stringify({ q: 'Hello', source: 'en', target: 'hi', format: 'text' }),
        }));
    });
    it('fails without credentials and never falls back to another service', async () => {
        vi.stubEnv('GOOGLE_TRANSLATE_API_KEY', '');
        const request = vi.fn(); vi.stubGlobal('fetch', request);
        await expect(translateText('Hello', 'en', 'hi')).rejects.toThrow('not configured');
        expect(request).not.toHaveBeenCalled();
    });
    it('validates languages and text before making requests and limits the initial capability to Hindi and English', async () => {
        const request = vi.fn(); vi.stubGlobal('fetch', request);
        expect(translationLanguage('hi-IN')).toBe('hi');
        expect(translationLanguage('en-GB')).toBe('en');
        for (const code of ['garbage', 'bo-IN', 'zh-TW', 'fr', 'en-IN', 'en-US&key=bad', '../hi']) {
            await expect(translateText('Hello', 'en', code)).rejects.toThrow('Unsupported');
        }
        for (const text of ['', ' ', 'x'.repeat(2001)]) await expect(translateText(text, 'en', 'hi')).rejects.toThrow('1–2000');
        expect(request).not.toHaveBeenCalled();
        await expect(translateText('Hello', 'en-US', 'en-GB')).resolves.toEqual({ translatedText: 'Hello', sourceLanguage: 'en-US', targetLanguage: 'en-GB' });
    });
    it.each([{}, { data: { translations: [] } }, { data: { translations: [{ translatedText: 7 }] } }, { data: { translations: [{ translatedText: '' }] } }])('rejects malformed provider results', async response => {
        vi.stubEnv('GOOGLE_TRANSLATE_API_KEY', 'test-secret');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => response }));
        await expect(translateText('Hello', 'en', 'hi')).rejects.toThrow('provider request failed');
    });
    it('redacts HTTP errors and aborted provider requests', async () => {
        vi.stubEnv('GOOGLE_TRANSLATE_API_KEY', 'test-secret');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
        await expect(translateText('Hello', 'en', 'hi')).rejects.toThrow('provider request failed');
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('test-secret or private text', 'TimeoutError')));
        await expect(translateText('Hello', 'en', 'hi')).rejects.toThrow('Translation unavailable: provider request failed');
    });
});
