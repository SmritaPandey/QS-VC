import CancelScheduledMeeting from './CancelScheduledMeeting';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { clearSession, getToken } from '../lib/session';
import ActionContents from './ActionContents';

const API = import.meta.env.VITE_MEETING_URL || import.meta.env.VITE_API_URL || '';

export type HostedMeeting = {
    id: string; meetingCode: string; title: string; status: string; type?: string;
    scheduledStart?: string | null; scheduledEnd?: string | null; actualStart?: string | null; actualEnd?: string | null; createdAt: string;
};

const when = (m: HostedMeeting) => new Date(m.scheduledStart || m.actualStart || m.createdAt);
const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = (d: Date) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** Split into Live now / Upcoming / Past, the way a host thinks about their meetings. */
export function groupHosted(meetings: HostedMeeting[], now = Date.now()) {
    const live: HostedMeeting[] = [], upcoming: HostedMeeting[] = [], past: HostedMeeting[] = [];
    for (const m of meetings) {
        if (m.status === 'cancelled') continue;
        if (m.status === 'active') live.push(m);
        else if (m.status !== 'ended' && m.scheduledStart && new Date(m.scheduledEnd || m.scheduledStart).getTime() >= now - 15 * 60_000) upcoming.push(m);
        else past.push(m);
    }
    upcoming.sort((a, b) => when(a).getTime() - when(b).getTime());
    past.sort((a, b) => when(b).getTime() - when(a).getTime());
    return { live, upcoming, past };
}

function Row({ meeting, label, onCancelled, onExpired }: { meeting: HostedMeeting; label: string; onCancelled: () => void; onExpired: () => void }) {
    const [copied, setCopied] = useState(false);
    const start = when(meeting);
    const link = `${window.location.origin}/meeting/${encodeURIComponent(meeting.meetingCode)}/preview`;
    const ended = meeting.status === 'ended';
    return <article className="workspace-meeting-row" data-status={meeting.status}>
        <time dateTime={start.toISOString()}><span className="workspace-row-day">{fmtDay(start)}</span>{meeting.scheduledStart || meeting.actualStart ? fmtTime(start) : ''}</time>
        <div>
            <h2>{meeting.title || 'Untitled meeting'}</h2>
            <p><span className="workspace-code">{meeting.meetingCode}</span><span className="workspace-status">{label}</span></p>
        </div>
        <div className="workspace-row-actions">
            {meeting.scheduledStart && meeting.status === 'waiting' && <CancelScheduledMeeting id={meeting.id}
                title={meeting.title || meeting.meetingCode} onCancelled={onCancelled} onExpired={onExpired} />}
            <button type="button" className="workspace-row-join workspace-row-secondary" aria-label={`Copy invite link for ${meeting.title || meeting.meetingCode}`} onClick={() => { void navigator.clipboard?.writeText(link).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }).catch(() => {}); }}>
                <span className="mi mi-sm" aria-hidden="true">{copied ? 'check' : 'link'}</span>{copied ? 'Copied' : 'Copy link'}
            </button>
            {ended
                ? <Link className="workspace-row-join workspace-row-secondary" to={`/recordings/${encodeURIComponent(meeting.meetingCode)}`}>Recordings</Link>
                : <Link className="workspace-row-join qsvc-action" to={`/meeting/${encodeURIComponent(meeting.meetingCode)}/preview`}><ActionContents>{meeting.status === 'active' ? 'Rejoin' : 'Start'}</ActionContents></Link>}
        </div>
    </article>;
}

/** "Meetings I host": everything the signed-in user created, so they can start, share or review it. */
export default function HostedMeetings({ onExpired }: { onExpired: () => void }) {
    const [meetings, setMeetings] = useState<HostedMeeting[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [refresh, setRefresh] = useState(0);
    const [notice, setNotice] = useState('');
    const cancelled = (id: string) => {
        setMeetings(items => items.filter(item => item.id !== id));
        setNotice('Meeting cancelled.');
        setRefresh(value => value + 1);
    };
    const [summary, setSummary] = useState<{ links: number; scheduled: number; active: number } | null>(null);
    const [summaryUnavailable, setSummaryUnavailable] = useState(false);
    const [filter, setFilter] = useState<'all' | 'upcoming' | 'live' | 'past'>('all');
    const [showAllPast, setShowAllPast] = useState(false);
    useEffect(() => {
        const controller = new AbortController();
        const token = getToken();
        let active = true;
        setLoading(true); setError('');
        fetch(`${API}/api/meetings?host=me&limit=100`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
            .then(async response => {
                if (!active) return;
                if (response.status === 401) { if (clearSession(token)) onExpired(); return; }
                if (!response.ok) throw new Error();
                const value = await response.json();
                if (!Array.isArray(value.meetings)) throw new Error();
                if (active) setMeetings(value.meetings.filter((m: HostedMeeting) => typeof m.id === 'string' && typeof m.meetingCode === 'string'));
            }).catch(() => { if (active) setError('We couldn’t load the meetings you host. Try again.'); })
            .finally(() => { if (active) setLoading(false); });
        const timer = window.setTimeout(() => controller.abort(), 10000);
        return () => { active = false; window.clearTimeout(timer); controller.abort(); };
    }, [refresh, onExpired]);

    useEffect(() => {
        const controller = new AbortController();
        const token = getToken();
        setSummaryUnavailable(false);
        fetch(`${API}/api/meetings/me/analytics?quarters=1`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
        }).then(async response => {
            if (!response.ok) throw new Error('Summary unavailable');
            const { totals } = await response.json();
            if (![totals?.links, totals?.scheduled, totals?.active].every(Number.isSafeInteger)) throw new Error('Invalid summary');
            if (!controller.signal.aborted && token === getToken()) setSummary(totals);
        }).catch(() => { if (!controller.signal.aborted && token === getToken()) { setSummary(null); setSummaryUnavailable(true); } });
        return () => controller.abort();
    }, [refresh]);

    if (loading) return <div className="workspace-state" role="status"><span className="mi" aria-hidden="true">calendar_month</span><h2>Loading your meetings…</h2><p>Meetings you created will appear here.</p></div>;
    if (error) return <div className="workspace-state" role="alert"><span className="mi" aria-hidden="true">cloud_off</span><h2>Your meetings aren’t available right now</h2><p>{error}</p><button className="qsvc-action qsvc-action--secondary" onClick={() => setRefresh(v => v + 1)}><ActionContents>Try again</ActionContents></button></div>;
    const { live, upcoming, past } = groupHosted(meetings);
    const shownPast = showAllPast ? past : past.slice(0, 8);
    return <div className="workspace-hosted">
        <section className="workspace-personal-overview" aria-label="Your meeting activity">
            <dl>
                <div><dt>Links created</dt><dd>{summary?.links.toLocaleString() ?? '—'}</dd></div>
                <div><dt>Meetings scheduled</dt><dd>{summary?.scheduled.toLocaleString() ?? '—'}</dd></div>
                <div><dt>Meetings marked active</dt><dd>{summary?.active.toLocaleString() ?? '—'}</dd></div>
            </dl>
            {summaryUnavailable && <p role="status">Activity totals are unavailable. Your meeting list is still available.</p>}
            <label>Show <select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
                <option value="all">All meetings</option><option value="upcoming">Upcoming</option>
                <option value="live">Live now</option><option value="past">Past and instant</option>
            </select></label>
        </section>
        {notice && <p role="status">{notice}</p>}
        {filter === 'live' && !live.length && <p className="workspace-group-empty">You have no live meetings.</p>}
        {filter === 'past' && !past.length && <p className="workspace-group-empty">You have no past meetings.</p>}
        {(filter === 'all' || filter === 'live') && live.length > 0 && <section aria-labelledby="hosted-live"><h3 id="hosted-live" className="workspace-group-title"><span className="workspace-live-dot" aria-hidden="true" />Live now</h3>{live.map(m => <Row key={m.id} meeting={m} onCancelled={() => cancelled(m.id)} onExpired={onExpired} label="In progress" />)}</section>}
        {(filter === 'all' || filter === 'upcoming') && <section aria-labelledby="hosted-upcoming"><h3 id="hosted-upcoming" className="workspace-group-title">Upcoming ({upcoming.length})</h3>
            {upcoming.length ? upcoming.map(m => <Row key={m.id} meeting={m} onCancelled={() => cancelled(m.id)} onExpired={onExpired} label="Scheduled" />) : <p className="workspace-group-empty">Nothing scheduled. <Link to="/schedule">Schedule a meeting</Link></p>}
        </section>}
        {(filter === 'all' || filter === 'past') && past.length > 0 && <section aria-labelledby="hosted-past"><h3 id="hosted-past" className="workspace-group-title">Past and instant ({past.length})</h3>
            {shownPast.map(m => <Row key={m.id} meeting={m} onCancelled={() => cancelled(m.id)} onExpired={onExpired} label={m.status === 'ended' ? 'Ended' : 'Not started'} />)}
            {past.length > shownPast.length && <button className="workspace-load-more qsvc-action qsvc-action--secondary" onClick={() => setShowAllPast(true)}><ActionContents>Show all {past.length}</ActionContents></button>}
        </section>}
    </div>;
}
