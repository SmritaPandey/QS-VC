import { useEffect, useRef, useState } from 'react';
import { signaling } from '../lib/signaling';
import { getToken } from '../lib/session';
import '../styles/meeting-session-report.css';

type Participant = { sessionId?: string; startedAt?: string; peerId: string; displayName: string; durationMs: number; estimatedSpeakingMs: number; samples: number; leftAt: string | null; latest: { rttMs: number | null; jitterMs: number | null; packetLossPercent: number | null } | null; issues: { poorQualitySamples: number; metricsUnavailableSamples: number } };
type Report = { participants: Participant[]; incomplete?: boolean; persistence?: string; metricSource?: string };
const API = import.meta.env.VITE_MEETING_URL || import.meta.env.VITE_API_URL || '';
const minutes = (ms: number) => `${(ms / 60000).toFixed(1)} min`;
export default function MeetingSessionReport({ open, meetingCode, connected, onClose }: { open: boolean; meetingCode: string; connected: boolean; onClose: () => void }) {
    const [report, setReport] = useState<Report | null>(null);
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    const [loading, setLoading] = useState(false);
    const [source, setSource] = useState<'live' | 'saved'>('live');
    const [offset, setOffset] = useState(0);
    const [next, setNext] = useState<number | null>(null);
    const close = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!open) return;
        const previous = document.activeElement as HTMLElement | null;
        close.current?.focus();
        return () => previous?.focus();
    }, [open]);
    useEffect(() => {
        if (!open) return;
        let active = true;
        const controller = new AbortController();
        setLoading(true); setError(''); setReport(null); setNext(null);
        void (async () => {
            try {
                if (source === 'live') {
                    if (!connected) throw new Error('Reconnect to view the live report, or choose saved reports.');
                    const result = await signaling.request('getMeetingDiagnostics') as Report;
                    if (active) setReport(result);
                } else {
                    const token = getToken();
                    if (!token) throw new Error('Sign in as the meeting organiser or administrator to view saved reports.');
                    const response = await fetch(`${API}/api/meetings/code/${encodeURIComponent(meetingCode)}/session-reports?offset=${offset}&limit=50`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
                    if (!response.ok) throw new Error(response.status === 403 ? 'Only the meeting organiser or administrator can view saved reports.' : 'Saved reports could not be loaded.');
                    const data = await response.json();
                    if (active) { setReport({ participants: data.reports.map((row: { participant: Participant; sessionId: string; startedAt: string }) => ({ ...row.participant, sessionId: row.sessionId, startedAt: row.startedAt })), metricSource: data.metricSource, incomplete: data.reports.some((row: { incomplete: boolean }) => row.incomplete) }); setNext(data.nextOffset); }
                }
            } catch (failure) { if (active) setError(failure instanceof Error ? failure.message : 'The report could not be loaded.'); }
            finally { if (active) setLoading(false); }
        })();
        return () => { active = false; controller.abort(); };
    }, [open, meetingCode, connected, source, offset, retry]);
    if (!open) return null;
    return <section className="meeting-session-report" role="dialog" aria-labelledby="session-report-title" onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
        <header><h2 id="session-report-title">Attendance and quality</h2><button type="button" ref={close} onClick={onClose} aria-label="Close meeting report">×</button></header>
        <label>Report source <select value={source} onChange={event => { setSource(event.target.value as 'live' | 'saved'); setOffset(0); }}><option value="live">Current session</option><option value="saved">Saved sessions</option></select></label>
        <p>Attendance is observed by the server. Speaking time estimates microphone sound activity; network figures are reported by each browser.</p>
        {loading && <p role="status">Loading report…</p>}{error && <div><p role="alert">{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Retry report</button></div>}
        {report && <><p role="status">{report.participants.length ? `${report.participants.length} participant records on this page.` : 'No participant records available yet.'}{report.incomplete ? ' This report is incomplete.' : ''}{report.persistence === 'some-records-unsaved' ? ' Some records could not be saved.' : ''}</p>
            <div className="session-report-table" tabIndex={0} aria-label="Participant attendance and network measurements"><table><thead><tr>{source === 'saved' && <th>Session started</th>}<th>Name</th><th>Attendance</th><th>Sound activity</th><th>RTT</th><th>Jitter</th><th>Loss</th><th>Poor quality samples</th></tr></thead><tbody>{report.participants.map((peer, index) => <tr key={`${peer.peerId}-${index}`}>{source === 'saved' && <td>{peer.startedAt ? new Date(peer.startedAt).toLocaleString() : 'Unknown'}<br/><small>{peer.sessionId}</small></td>}<th scope="row">{peer.displayName}</th><td>{minutes(peer.durationMs)}</td><td>{minutes(peer.estimatedSpeakingMs)}</td><td>{peer.latest?.rttMs == null ? 'Unknown' : `${Math.round(peer.latest.rttMs)} ms`}</td><td>{peer.latest?.jitterMs == null ? 'Unknown' : `${Math.round(peer.latest.jitterMs)} ms`}</td><td>{peer.latest?.packetLossPercent == null ? 'Unknown' : `${peer.latest.packetLossPercent.toFixed(1)}%`}</td><td>{peer.issues.poorQualitySamples} / {peer.samples}</td></tr>)}</tbody></table></div>
            {source === 'saved' && <nav aria-label="Report pages"><button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button><button type="button" disabled={next === null} onClick={() => next !== null && setOffset(next)}>Next</button></nav>}
        </>}
    </section>;
}
