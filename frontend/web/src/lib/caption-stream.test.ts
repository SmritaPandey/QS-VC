import { describe, expect, it } from 'vitest';
import { captionLanguageOptions, needsCaptionTranslation, supportedSpeechLanguage, transcriptToSrt, transcriptToText, upsertCaption } from './caption-stream';
import { floatToPcm16Base64, resampleTo16k } from './pcm';

const line = (id: string, text: string, isFinal: boolean) => ({ id, speakerName: 'Asha', text, isFinal, timestamp: 1 });

describe('caption stream', () => {
    it('replaces interim text with the final and translated line, never the reverse', () => {
        let list = upsertCaption([], line('a', 'Meet', false));
        list = upsertCaption(list, line('a', 'Meeting is', false));
        expect(list).toHaveLength(1);
        list = upsertCaption(list, line('a', 'Meeting is tomorrow', true));
        list = upsertCaption(list, line('a', 'Meeting', false));
        expect(list).toEqual([line('a', 'Meeting is tomorrow', true)]);
        list = upsertCaption(list, line('b', 'Next', false));
        expect(list.map(item => item.id)).toEqual(['a', 'b']);
    });
    it('offers only server languages when server recognition is on, keeping the current one', () => {
        const options = captionLanguageOptions([{ code: 'hi', name: 'Hindi' }, { code: 'ta', name: 'Tamil' }], 'en-US');
        expect(options.map(option => option.code)).toEqual(['en-US', 'hi-IN', 'ta-IN']);
        const browser = captionLanguageOptions(null, 'as-IN');
        expect(browser[0].code).toBe('as-IN'); // unsupported in browsers but still selectable
        expect(browser.some(option => option.code === 'mai-IN')).toBe(false);
        const expanded = captionLanguageOptions(null, 'en-US', [{ code: 'haw', name: 'Hawaiian' }]);
        expect(expanded).toContainEqual({ code: 'haw', label: 'Hawaiian' });
    });
    it('honors the exact recognition locale and falls back only to an advertised base language', () => {
        const languages = [{ code: 'en-US', name: 'English (US)' }, { code: 'en-GB', name: 'English (UK)' }, { code: 'hi', name: 'Hindi' }];
        expect(supportedSpeechLanguage(languages, 'en-GB')).toBe('en-GB');
        expect(supportedSpeechLanguage(languages, 'hi-IN')).toBe('hi');
        expect(supportedSpeechLanguage(languages, 'ta-IN')).toBeUndefined();
        expect(captionLanguageOptions(languages, 'en-GB').map(item => item.code)).toEqual(['en-US', 'en-GB', 'hi-IN']);
    });
    it('keeps distinct regional translations separate and respects original output', () => {
        expect(needsCaptionTranslation('sr-Cyrl', 'sr-Latn')).toBe(true);
        expect(needsCaptionTranslation('zh', 'zh-TW')).toBe(true);
        expect(needsCaptionTranslation('zh-CN', 'zh-TW')).toBe(true);
        expect(needsCaptionTranslation('zh-Hant', 'zh-Hans')).toBe(true);
        expect(needsCaptionTranslation('en-US', 'en-GB')).toBe(false);
        expect(needsCaptionTranslation('en-US', 'en')).toBe(false);
        expect(needsCaptionTranslation('hi', 'hi-IN')).toBe(false);
        expect(needsCaptionTranslation('zh-TW', 'original')).toBe(false);
        expect(needsCaptionTranslation('bn-IN', 'hi-IN')).toBe(true);
    });
    it('exports text and SRT', () => {
        const entries = [{ id: '1', speaker: 'Asha', language: 'hi', text: 'नमस्ते', timestamp: 0 }, { id: '2', speaker: 'Ravi', language: 'en', text: 'Hello', timestamp: 2500 }];
        expect(transcriptToSrt(entries)).toBe('1\n00:00:00,000 --> 00:00:02,500\nAsha: नमस्ते\n\n2\n00:00:02,500 --> 00:00:06,500\nRavi: Hello\n');
        expect(transcriptToText(entries, '## Summary')).toContain('## Summary\n\n---\n\nTranscript\n\n[');
    });
});

describe('server speech audio', () => {
    it('resamples 48 kHz to 16 kHz and encodes little-endian PCM16', () => {
        const input = new Float32Array(48).fill(0.5);
        expect(resampleTo16k(input, 48_000)).toHaveLength(16);
        const pcm = Buffer.from(floatToPcm16Base64(new Float32Array([0, 1, -1])), 'base64');
        expect([...new Int16Array(pcm.buffer, pcm.byteOffset, 3)]).toEqual([0, 32767, -32768]);
    });
});

describe('IndicConformer languages', () => {
    it('labels the extra scheduled languages the speech server reports', () => {
        const options = captionLanguageOptions([{ code: 'brx', name: 'Bodo' }, { code: 'sat', name: 'Santali' }, { code: 'mni', name: 'Manipuri' }], 'brx-IN');
        expect(options.map(option => option.code)).toEqual(['brx-IN', 'sat-IN', 'mni-IN']);
        expect(options[0].label).toContain('Bodo');
    });
});
