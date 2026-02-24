/**
 * Network quality indicator based on WebRTC stats.
 * Reports quality as 1-5 bars.
 */
import React from 'react';

export interface QualityStats {
    rtt: number;        // round-trip time in ms
    jitter: number;     // jitter in ms
    packetLoss: number; // 0-100%
    bitrate: number;    // kbps
}

interface Props {
    stats: QualityStats;
}

/** Calculate quality level 1-5 from stats. */
export function computeQuality(stats: QualityStats): number {
    let score = 5;

    // RTT scoring
    if (stats.rtt > 400) score -= 2;
    else if (stats.rtt > 200) score -= 1;

    // Jitter scoring
    if (stats.jitter > 50) score -= 1;
    else if (stats.jitter > 30) score -= 0.5;

    // Packet loss scoring
    if (stats.packetLoss > 5) score -= 2;
    else if (stats.packetLoss > 2) score -= 1;

    return Math.max(1, Math.min(5, Math.round(score)));
}

const NetworkQualityIndicator: React.FC<Props> = ({ stats }) => {
    const quality = computeQuality(stats);
    const bars = [1, 2, 3, 4, 5];

    const qualityLabels: Record<number, string> = {
        1: 'Very Poor',
        2: 'Poor',
        3: 'Fair',
        4: 'Good',
        5: 'Excellent',
    };

    return (
        <div className="network-quality" title={qualityLabels[quality]}>
            {bars.map((bar) => (
                <div
                    key={bar}
                    className={`quality-bar ${bar <= quality ? `quality-${quality}` : 'quality-empty'}`}
                    style={{ height: `${bar * 3 + 2}px` }}
                />
            ))}
        </div>
    );
};

export default NetworkQualityIndicator;
