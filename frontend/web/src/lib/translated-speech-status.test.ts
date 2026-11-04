import { describe, expect, it } from 'vitest';
import { playbackFailure, translationFailure } from './translated-speech-status';

describe('translated speech diagnostics', () => {
    it('distinguishes missing cloud consent from an unsupported translation pair', () => {
        expect(translationFailure(new Error('The speaker has not enabled Google Cloud translation')).gate).toBe('consent');
        expect(translationFailure(new Error('Language pair unavailable on configured server'))).toMatchObject({
            gate: 'translation', message: expect.stringContaining('language pair'),
        });
    });

    it('distinguishes a missing voice from output failure or a start timeout', () => {
        expect(playbackFailure('voice-unavailable').gate).toBe('voice');
        expect(playbackFailure('audio-hardware').gate).toBe('output');
        expect(playbackFailure('start-timeout').gate).toBe('output');
    });
});
