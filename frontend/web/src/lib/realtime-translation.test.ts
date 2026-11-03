import { afterEach, expect, it, vi } from 'vitest';
import { TranslationEngine } from './realtime-translation';
afterEach(() => vi.unstubAllGlobals());
it('never sends a failed translation to another provider or returns source text as success', async () => {
    const request = vi.fn().mockResolvedValue({ ok: false }); vi.stubGlobal('fetch', request);
    await expect(new TranslationEngine().translate('नमस्ते', 'hi-IN', 'en-US')).rejects.toThrow('unavailable');
    expect(request).toHaveBeenCalledOnce(); expect(request.mock.calls[0][0]).toBe('/api/translate');
});
it('validates provider output and does not cache a malformed response', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ translatedText: 42 }) }); vi.stubGlobal('fetch', request);
    const engine = new TranslationEngine();
    await expect(engine.translate('नमस्ते', 'hi-IN', 'en-US')).rejects.toThrow('unavailable');
    request.mockResolvedValue({ ok: true, json: async () => ({ translatedText: 'Hello' }) });
    expect((await engine.translate('नमस्ते', 'hi-IN', 'en-US')).translatedText).toBe('Hello');
    expect((await engine.translate('नमस्ते', 'hi-IN', 'en-US')).confidence).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
});
it('preserves case and locale distinctions in cached requests', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ translatedText: 'translated' }) }); vi.stubGlobal('fetch', request);
    const engine = new TranslationEngine();
    await engine.translate('US', 'en-US', 'hi-IN'); await engine.translate('us', 'en-US', 'hi-IN');
    await engine.translate('US', 'en-GB', 'hi-IN'); await engine.translate('US', 'en-US', 'hi-IN');
    expect(request).toHaveBeenCalledTimes(3);
});
it('does not send same-language text to a service', async () => {
    const request = vi.fn(); vi.stubGlobal('fetch', request);
    expect((await new TranslationEngine().translate('Hello', 'en-US', 'en-US')).translatedText).toBe('Hello');
    expect(request).not.toHaveBeenCalled();
});
