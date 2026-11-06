/**
 * Light haptic feedback for meeting controls.
 * - Android / Chromium: Vibration API.
 * - iOS Safari 18+: no Vibration API, but toggling a native `<input type="checkbox" switch>`
 *   through its label plays the system tap haptic, so we keep one hidden switch for that.
 * Desktop browsers have no vibration API, so there the sound (lib/sounds.ts) is the feedback.
 */
import { playSound } from './sounds';

export type HapticKind = 'tap' | 'toggleOn' | 'toggleOff' | 'success' | 'warning' | 'notice';

const PATTERNS: Record<HapticKind, number | number[]> = {
    tap: 8,
    toggleOn: 12,
    toggleOff: [6, 40, 6],
    success: [10, 30, 14],
    warning: [20, 60, 20],
    notice: [12, 35, 12],
};

let iosLabel: HTMLLabelElement | null = null;

function iosSwitch(): HTMLLabelElement | null {
    if (typeof document === 'undefined') return null;
    if (iosLabel?.isConnected) return iosLabel;
    const label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:fixed;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;left:-9999px;top:0';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    label.appendChild(input);
    document.body.appendChild(label);
    iosLabel = label;
    return label;
}

/** Feedback for a control press: a soft sound everywhere, plus vibration where the device supports it. */
export function haptic(kind: HapticKind = 'tap'): void {
    playSound(kind);
    try {
        const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
        if (typeof nav.vibrate === 'function') {
            nav.vibrate(PATTERNS[kind]);
            return;
        }
        if (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
            iosSwitch()?.click();
        }
    } catch {
        /* haptics are best-effort */
    }
}
