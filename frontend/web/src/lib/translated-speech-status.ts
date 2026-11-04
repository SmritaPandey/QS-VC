export type SpeechGate = 'sharing' | 'consent' | 'translation' | 'voice' | 'output';
export type SpeechDiagnostic = { gate: SpeechGate; message: string };

export function translationFailure(error: unknown): SpeechDiagnostic {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('speaker has not enabled Google Cloud translation')) {
        return { gate: 'consent', message: 'The speaker has not allowed Google Cloud translation for this caption.' };
    }
    if (message.includes('Language pair unavailable')) {
        return { gate: 'translation', message: 'The server does not support this source and target language pair.' };
    }
    return { gate: 'translation', message: 'The server could not translate this segment into your selected language.' };
}

export function playbackFailure(code: string): SpeechDiagnostic {
    if (code === 'voice-unavailable' || code === 'language-unavailable') {
        return { gate: 'voice', message: 'The matching device voice is unavailable.' };
    }
    return { gate: 'output', message: code === 'audio-hardware'
        ? 'The browser reported a problem with its audio output device.'
        : 'The browser could not start or complete translated playback. Check its audio output and permissions.' };
}
