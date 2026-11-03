import { preferencesAllowed } from './storage-consent';
export type ReactionSound = 'off' | 'chime' | 'pop' | 'sparkle';
export type ReactionEffect = 'subtle' | 'celebrate' | 'none';
export interface ReactionPreferences { sound: ReactionSound; effect: ReactionEffect }
const KEY = 'qsvc:reaction-preferences';

export function readReactionPreferences(): ReactionPreferences {
    try {
        const value = JSON.parse((preferencesAllowed() ? localStorage.getItem(KEY) : null) || '{}');
        return {
            sound: ['chime', 'pop', 'sparkle'].includes(value?.sound) ? value.sound : 'off',
            effect: ['celebrate', 'none'].includes(value?.effect) ? value.effect : 'subtle',
        };
    } catch { return { sound: 'off', effect: 'subtle' }; }
}
export function saveReactionPreferences(value: ReactionPreferences): void {
    try { if (preferencesAllowed()) localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* Device storage may be disabled. */ }
}

let lastPlayed = -Infinity;
/** Local speaker output only: never connected to a meeting stream or producer. */
export async function playReactionSound(sound: ReactionSound): Promise<void> {
    if (sound === 'off' || typeof window === 'undefined') return;
    const now = Date.now();
    if (now - lastPlayed < 250) return;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    let context: AudioContext | undefined;
    try {
        context = new Ctor();
        lastPlayed = now;
        if (context.state === 'suspended') await context.resume();
        const notes = sound === 'pop' ? [420] : sound === 'chime' ? [660, 880] : [880, 1100, 1320];
        notes.forEach((frequency, index) => {
            const oscillator = context!.createOscillator();
            const gain = context!.createGain();
            const at = context!.currentTime + index * 0.07;
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(frequency, at);
            oscillator.frequency.exponentialRampToValueAtTime(sound === 'pop' ? 140 : frequency, at + 0.12);
            gain.gain.setValueAtTime(0.0001, at);
            gain.gain.exponentialRampToValueAtTime(0.045, at + 0.008);
            gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
            oscillator.connect(gain);
            gain.connect(context!.destination);
            oscillator.onended = () => {
                oscillator.disconnect(); gain.disconnect();
                if (index === notes.length - 1) void context!.close().catch(() => {});
            };
            oscillator.start(at);
            oscillator.stop(at + 0.18);
        });
    } catch {
        if (context && context.state !== 'closed') void context.close().catch(() => {});
    }
}
