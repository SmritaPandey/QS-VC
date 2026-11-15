export interface ConnectionQualitySample {
    rttMs: number | null; jitterMs: number | null; packetLossPercent: number | null;
    audioActive: boolean | null; measuredAt: number; status: 'unknown' | 'good' | 'fair' | 'poor';
}
type Counter = { received: number; lost: number; timestamp: number };
export type QualityBaseline = Map<string, Counter>;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** WebRTC jitter/RTT are seconds. Loss is a delta over this polling interval, never a lifetime total. */
export function measureConnectionQuality(reports: RTCStatsReport[], previous: QualityBaseline = new Map(), now = Date.now()): { sample: ConnectionQualitySample; baseline: QualityBaseline } {
    const baseline: QualityBaseline = new Map();
    const rtts: number[] = [], jitters: number[] = [];
    let received = 0, lost = 0, hasLossDelta = false, audioActive: boolean | null = null;
    reports.forEach((report, transport) => {
        const stats: any[] = [];
        report.forEach(stat => stats.push(stat));
        const selected = new Set(stats.filter(stat => stat.type === 'transport' && stat.selectedCandidatePairId).map(stat => stat.selectedCandidatePairId));
        for (const stat of stats) {
            if (stat.type === 'candidate-pair' && (selected.has(stat.id) || (!selected.size && stat.nominated && stat.state === 'succeeded')) && finite(stat.currentRoundTripTime)) rtts.push(stat.currentRoundTripTime * 1000);
            if (stat.type === 'inbound-rtp' && !stat.isRemote) {
                if (finite(stat.jitter)) jitters.push(stat.jitter * 1000);
                if (finite(stat.packetsReceived) && finite(stat.packetsLost) && finite(stat.timestamp)) {
                    const key = `${transport}:${stat.id}`;
                    const before = previous.get(key);
                    baseline.set(key, { received: stat.packetsReceived, lost: stat.packetsLost, timestamp: stat.timestamp });
                    if (before && stat.timestamp > before.timestamp && stat.packetsReceived >= before.received && stat.packetsLost >= before.lost) {
                        received += stat.packetsReceived - before.received; lost += stat.packetsLost - before.lost; hasLossDelta = true;
                    }
                }
            }
            if (stat.type === 'media-source' && stat.kind === 'audio' && finite(stat.audioLevel)) audioActive = Boolean(audioActive || stat.audioLevel > 0.02);
        }
    });
    const rttMs = rtts.length ? Math.max(...rtts) : null;
    const jitterMs = jitters.length ? Math.max(...jitters) : null;
    const packetLossPercent = hasLossDelta && received + lost > 0 ? lost / (received + lost) * 100 : null;
    const known = [rttMs, jitterMs, packetLossPercent].filter((value): value is number => value !== null);
    const status = !known.length ? 'unknown' : (rttMs !== null && rttMs > 500) || (jitterMs !== null && jitterMs > 50) || (packetLossPercent !== null && packetLossPercent > 5) ? 'poor'
        : (rttMs !== null && rttMs > 250) || (jitterMs !== null && jitterMs > 30) || (packetLossPercent !== null && packetLossPercent > 2) ? 'fair' : known.length === 3 ? 'good' : 'unknown';
    return { sample: { rttMs, jitterMs, packetLossPercent, audioActive, measuredAt: now, status }, baseline };
}
