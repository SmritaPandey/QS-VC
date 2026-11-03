import { afterEach, expect, it, vi } from 'vitest';
import { preferencesAllowed, saveStorageConsent } from './storage-consent';
import { saveReactionPreferences } from './reaction-sounds';
afterEach(() => vi.unstubAllGlobals());
it('blocks preference writes before consent and after denial, clears saved preferences without clearing login', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) });
    expect(preferencesAllowed()).toBe(false);
    saveReactionPreferences({ sound: 'pop', effect: 'none' });
    expect(data.has('qsvc:reaction-preferences')).toBe(false);
    saveStorageConsent(true);
    saveReactionPreferences({ sound: 'pop', effect: 'none' });
    expect(data.has('qsvc:reaction-preferences')).toBe(true);
    data.set('token', 'untouched');
    saveStorageConsent(false);
    expect(preferencesAllowed()).toBe(false);
    expect(data.has('qsvc:reaction-preferences')).toBe(false);
    expect(data.get('token')).toBe('untouched');
});

it('honours denial even if an old allow is readable but writes fail', () => {
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', {getItem:()=> 'allow',setItem:()=>{throw Error('quota');},removeItem});
    saveStorageConsent(false);
    expect(preferencesAllowed()).toBe(false);
    expect(removeItem).toHaveBeenCalledWith('qsvc:reaction-preferences');
});
