import { preferencesAllowed } from './storage-consent';
/**
 * Small interface sounds for meeting controls, synthesised with Web Audio
 * (no audio files, works offline / on the intranet).
 * Browsers only allow audio after a user gesture; every call here comes from a click.
 * Turn off with localStorage 'qsvc:ui-sounds' = 'off'.
 */
export type SoundKind = 'tap' | 'toggleOn' | 'toggleOff' | 'success' | 'warning' | 'notice';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
    try {
        if (preferencesAllowed() && localStorage.getItem('qsvc:ui-sounds') === 'off') return null;
    } catch { /* storage blocked: keep sounds on */ }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) ctx = new Ctor();
    if (ctx.state === 'suspended') ctx.resume().catch(() => { });
    return ctx;
}

/** One soft sine blip: frequency glide, quick attack, exponential release. */
function blip(ac: AudioContext, at: number, from: number, to: number, length: number, volume: number) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + length);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(gain).connect(ac.destination);
    osc.start(at);
    osc.stop(at + length + 0.02);
}

export function playSound(kind: SoundKind = 'tap'): void {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime + 0.005;
    switch (kind) {
        case 'tap': blip(ac, t, 1400, 1100, 0.04, 0.05); break;
        case 'toggleOn': blip(ac, t, 620, 660, 0.06, 0.07); blip(ac, t + 0.06, 880, 920, 0.08, 0.07); break;
        case 'toggleOff': blip(ac, t, 700, 660, 0.06, 0.06); blip(ac, t + 0.06, 470, 440, 0.09, 0.06); break;
        case 'success': blip(ac, t, 1040, 1320, 0.09, 0.06); break;
        case 'warning': blip(ac, t, 520, 500, 0.08, 0.07); blip(ac, t + 0.1, 400, 380, 0.12, 0.07); break;
        case 'notice': blip(ac, t, 780, 780, 0.1, 0.05); blip(ac, t + 0.12, 1040, 1040, 0.14, 0.05); break;
    }
}
