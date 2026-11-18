import { useEffect, useRef, useState } from 'react';
import { measureConnectionQuality, type ConnectionQualitySample, type QualityBaseline } from '../lib/connection-quality';
import '../styles/connection-quality.css';
interface Props { audioOnly?: boolean; networkProfile?: string; onAudioOnlyChange?: (enabled: boolean) => Promise<void>; open: boolean; connected: boolean; getStats: () => Promise<RTCStatsReport[]>; onSample?: (sample: ConnectionQualitySample) => Promise<unknown> | void; onClose: () => void; onOpenReport?: () => void; }
const unknownSample: ConnectionQualitySample = { rttMs: null, jitterMs: null, packetLossPercent: null, audioActive: null, measuredAt: 0, status: 'unknown' };
const value = (number: number | null, unit: string) => number === null ? 'Not measured' : `${number.toFixed(unit === '%' ? 1 : 0)} ${unit}`;
export default function ConnectionQualityPanel({ open, connected, getStats, onSample, onClose, onOpenReport, audioOnly, networkProfile, onAudioOnlyChange }: Props) {
    const [sample, setSample] = useState(unknownSample);
    const [reportError, setReportError] = useState(false);
    const [changing, setChanging] = useState(false);
    const [modeError, setModeError] = useState('');
    const close = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!open) return;
        const previous = document.activeElement as HTMLElement | null;
        close.current?.focus();
        return () => previous?.focus();
    }, [open]);
    const baseline = useRef<QualityBaseline>(new Map());
    const callbacks = useRef({ getStats, onSample }); callbacks.current = { getStats, onSample };
    useEffect(() => {
        baseline.current.clear(); setSample(unknownSample); setReportError(false);
        if (!connected) return;
        let active = true, working = false;
        const poll = async () => {
            if (working) return; working = true;
            try {
                const reports = await callbacks.current.getStats();
                if (!active) return;
                const measured = measureConnectionQuality(reports, baseline.current);
                baseline.current = measured.baseline; setSample(measured.sample);
                try { await callbacks.current.onSample?.(measured.sample); if (active) setReportError(false); } catch { if (active) setReportError(true); }
            } catch { if (active) { baseline.current.clear(); setSample({ ...unknownSample, measuredAt: Date.now() }); } }
            finally { working = false; }
        };
        void poll(); const timer = window.setInterval(poll, 5000);
        return () => { active = false; window.clearInterval(timer); };
    }, [connected]);
    if (!open) return null;
    return <section className="connection-quality-panel" role="dialog" aria-labelledby="connection-quality-title" onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
        <header><h2 id="connection-quality-title">Connection quality</h2><button type="button" ref={close} aria-label="Close connection quality" onClick={onClose}><span className="mi" aria-hidden="true">close</span></button></header>
        <p role="status">{connected ? sample.status === 'unknown' ? 'Waiting for measurable media traffic.' : `Your measured connection is ${sample.status}.` : 'Meeting is disconnected.'}</p>
        {onAudioOnlyChange && <div className="connection-audio-mode"><button type="button" aria-pressed={!!audioOnly} disabled={!connected || changing} onClick={async () => { setChanging(true); setModeError(''); try { await onAudioOnlyChange(!audioOnly); } catch { setModeError('Audio-only could not be changed. Try again.'); } finally { setChanging(false); } }}>{changing ? 'Applying…' : audioOnly ? 'Turn off Audio-only' : 'Use Audio-only'}</button><p>{audioOnly ? 'Incoming video is paused and your camera is off. Turning this off will not start your camera.' : networkProfile === 'audio-only' ? 'Video is temporarily paused for your connection. Audio stays available.' : 'Video quality adapts to your connection. Audio is prioritized.'}</p>{modeError && <p role="alert">{modeError}</p>}</div>}
        <dl><div><dt>Round-trip time</dt><dd>{value(sample.rttMs, 'ms')}</dd></div><div><dt>Receive jitter</dt><dd>{value(sample.jitterMs, 'ms')}</dd></div><div><dt>Receive packet loss</dt><dd>{value(sample.packetLossPercent, '%')}</dd></div></dl>
        <p>Live browser measurements, refreshed every 5 seconds. Missing metrics stay unknown. Connection indicators are not a quality guarantee.</p>
        {onOpenReport && <button type="button" onClick={onOpenReport}>Attendance and quality report</button>}
        {reportError && <p role="status">Your local readings are available, but the meeting report could not be updated.</p>}
    </section>;
}
