import type { ConnectionQualitySample } from './connection-quality';
export type NetworkProfile = 'good' | 'poor' | 'audio-only';
export function nextNetworkProfile(status: ConnectionQualitySample['status'], current: NetworkProfile, explicitAudioOnly: boolean, streak: { good: number; poor: number }): NetworkProfile {
    streak.good = status === 'good' ? streak.good + 1 : 0;
    streak.poor = status === 'poor' ? streak.poor + 1 : 0;
    return explicitAudioOnly || streak.poor >= 3 ? 'audio-only' : streak.poor >= 1 ? 'poor' : streak.good >= 3 ? 'good' : current;
}
