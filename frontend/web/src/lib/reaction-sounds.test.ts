import { afterEach, describe, expect, it, vi } from 'vitest';
import { readReactionPreferences, saveReactionPreferences } from './reaction-sounds';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('personal reaction preferences', () => {
    it('defaults to silent and tolerates blocked or malformed storage', () => {
        vi.stubGlobal('localStorage', { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } });
        expect(readReactionPreferences()).toEqual({ sound:'off', effect:'subtle' });
        expect(() => saveReactionPreferences({ sound:'chime', effect:'celebrate' })).not.toThrow();
        vi.stubGlobal('localStorage', { getItem: () => '{' });
        expect(readReactionPreferences().sound).toBe('off');
    });
    it('accepts only supported values and stores choices locally', () => {
        const setItem = vi.fn();
        vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'qsvc:storage-consent:v2' ? 'allow' : JSON.stringify({ sound:'remote-url', effect:'unknown' }), setItem });
        expect(readReactionPreferences()).toEqual({ sound:'off', effect:'subtle' });
        saveReactionPreferences({ sound:'pop', effect:'none' });
        expect(setItem).toHaveBeenCalledWith('qsvc:reaction-preferences', '{"sound":"pop","effect":"none"}');
    });
});
describe('local reaction audio', () => {
    it('off never opens audio; selected sound uses only speaker destination and cleans up', async () => {
        vi.resetModules();
        const { playReactionSound } = await import('./reaction-sounds');
        const destination = {};
        const close = vi.fn().mockResolvedValue(undefined);
        const oscillators: any[] = [];
        const gains: any[] = [];
        const Ctor = vi.fn(function() { return { state:'running', currentTime:1, destination, close,
            createOscillator: () => { const node = { frequency:{setValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()}, connect:vi.fn(), disconnect:vi.fn(), start:vi.fn(), stop:vi.fn(), onended:null }; oscillators.push(node); return node; },
            createGain: () => { const node = { gain:{setValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()}, connect:vi.fn(), disconnect:vi.fn() }; gains.push(node); return node; },
        }; });
        vi.stubGlobal('window', { AudioContext:Ctor });
        await playReactionSound('off'); expect(Ctor).not.toHaveBeenCalled();
        await playReactionSound('chime');
        expect(oscillators).toHaveLength(2);
        gains.forEach(node => expect(node.connect).toHaveBeenCalledWith(destination));
        oscillators.forEach(node => node.onended());
        expect(close).toHaveBeenCalledOnce();
        await playReactionSound('pop'); expect(Ctor).toHaveBeenCalledOnce();
    });
    it('unavailable or rejected audio does not prevent sending reactions', async () => {
        vi.resetModules();
        const { playReactionSound } = await import('./reaction-sounds');
        vi.stubGlobal('window', {});
        await expect(playReactionSound('pop')).resolves.toBeUndefined();
        const close = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('window', { AudioContext:vi.fn(function() { return { state:'suspended', resume:vi.fn().mockRejectedValue(Error('denied')), close }; }) });
        await expect(playReactionSound('sparkle')).resolves.toBeUndefined();
        expect(close).toHaveBeenCalledOnce();
    });
});
