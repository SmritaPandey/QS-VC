import { expect, it } from 'vitest';
import { nextNetworkProfile, type NetworkProfile } from './network-policy';
it('degrades quickly but waits for three good readings before restoring video', () => {
    const streak = { good: 0, poor: 0 };
    let profile: NetworkProfile = 'good';
    const sample = (status: 'good' | 'poor' | 'unknown') => profile = nextNetworkProfile(status, profile, false, streak);
    expect(sample('poor')).toBe('poor');
    expect(sample('poor')).toBe('poor');
    expect(sample('poor')).toBe('audio-only');
    expect(sample('good')).toBe('audio-only');
    expect(sample('unknown')).toBe('audio-only');
    expect(sample('good')).toBe('audio-only');
    expect(sample('good')).toBe('audio-only');
    expect(sample('good')).toBe('good');
});
it('never overrides explicit Audio-only even on a recovered connection', () => {
    const streak = { good: 10, poor: 0 };
    expect(nextNetworkProfile('good', 'audio-only', true, streak)).toBe('audio-only');
});
