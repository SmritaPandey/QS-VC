import CancelScheduledMeeting from './CancelScheduledMeeting';
import { useSession } from '../lib/use-session';
import ThemeSelect from './ThemeSelect';
import ActionContents from './ActionContents';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import BrandLogo from './BrandLogo';
import { clearSession, getToken, refreshSession } from '../lib/session';
import '../styles/workspace.css';
import useScrollReveal from '../lib/scroll-reveal';
import HostedMeetings from './HostedMeetings';
import MeetingSetupDialog, { type MeetingSetup } from './MeetingSetupDialog';

const API = import.meta.env.VITE_MEETING_URL || import.meta.env.VITE_API_URL || '';
type Meeting = { id: string; meetingCode: string; title: string; status: string; scheduledStart?: string; createdAt: string; isHost?: boolean; canCancel?: boolean };
type View = 'day' | 'hosted';
const VIEW_KEY = 'qsvc:workspace-view';
function savedView(): View { try { return localStorage.getItem(VIEW_KEY) === 'hosted' ? 'hosted' : 'day'; } catch { return 'day'; } }
type Props = { creating: boolean; signingOut: boolean; sessionError: string; onCreate: (setup: MeetingSetup) => void | Promise<void>; onSignOut: () => void; onExpired: () => void };
function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
function moveDay(date: Date, amount: number) { const next = new Date(date); next.setDate(next.getDate()+amount); return next; }

export default function SignedInWorkspace({ creating, signingOut, sessionError, onCreate, onSignOut, onExpired }: Props) {
    const navigate = useNavigate();
    const [selected, setSelected] = useState(() => new Date(new Date().setHours(0,0,0,0)));
    const session = useSession();
    const profile = session.profile;
    const [meetings, setMeetings] = useState<Meeting[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [join, setJoin] = useState('');
    const [joinError, setJoinError] = useState('');
    const [setupAction, setSetupAction] = useState<'link' | 'start' | null>(null);
    const [refresh, setRefresh] = useState(0);
    const [more, setMore] = useState(false);
    const [offset, setOffset] = useState(0);
    const [view, setViewState] = useState<View>(savedView);
    const setView = (next: View) => { setViewState(next); try { localStorage.setItem(VIEW_KEY, next); } catch { /* per-viewer convenience only */ } };
    const profileError = session.status === 'unavailable';
    const root = useRef<HTMLDivElement>(null);
    useScrollReveal(root);
    const selectedKey = dateKey(selected);
    useEffect(() => {
        window.scrollTo({top:0, left:0});
        const close = (event: PointerEvent) => {
            root.current?.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(detail => { if (!detail.contains(event.target as Node)) detail.open = false; });
        };
        document.addEventListener('pointerdown', close);
        return () => document.removeEventListener('pointerdown', close);
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        let active = true;
        setLoading(true); setError('');
        const day = new Date(selected); day.setHours(0,0,0,0);
        const query = new URLSearchParams({ start: day.toISOString(), end: moveDay(day,1).toISOString(), limit:'50', offset:String(offset) });
        const token = getToken();
        fetch(`${API}/api/meetings?${query}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
            .then(async response => {
                if (!active || getToken() !== token) return;
                if (response.status === 401) { if (clearSession(token)) onExpired(); return; }
                if (!response.ok) throw new Error();
                const value = await response.json();
                if (!Array.isArray(value.meetings)) throw new Error();
                if (!active || getToken() !== token) return;
                const items = value.meetings.filter((m: Meeting) => typeof m.id === 'string' && typeof m.meetingCode === 'string');
                setMeetings(old => offset ? [...old, ...items.filter((m: Meeting) => !old.some(item => item.id === m.id))] : items);
                setMore(value.meetings.length === 50);
            }).catch(() => { if (active) setError('We couldn’t load your organisation’s meetings. Try again.'); })
            .finally(() => { clearTimeout(timeout); if (active) setLoading(false); });
        return () => { active = false; clearTimeout(timeout); controller.abort(); };
    }, [selectedKey, offset, refresh, onExpired]);
    const selectDay = (day: Date) => { if (dateKey(day) === selectedKey) return; setSelected(day); setOffset(0); setMeetings([]); };
    const monday = moveDay(selected, -(selected.getDay()+6)%7);
    const newAction = (action: () => void) => {
        const detail = root.current?.querySelector<HTMLDetailsElement>('.workspace-new');
        if (detail) { detail.open = false; detail.querySelector<HTMLElement>('summary')?.focus(); }
        action();
    };
    const joinMeeting = (event: React.FormEvent) => {
        event.preventDefault(); setJoinError('');
        let code = join.trim();
        if (/^https?:\/\//i.test(code)) {
            try { const url = new URL(code); if (url.origin !== window.location.origin) throw new Error(); code = url.pathname.match(/^\/meeting\/([^/]+)(?:\/preview)?\/?$/)?.[1] || ''; } catch { code = ''; }
        }
        if (!/^[a-z0-9-]{3,40}$/i.test(code)) { setJoinError('Enter a QS-VC meeting code or a link from this website.'); return; }
        navigate(`/meeting/${encodeURIComponent(code.toUpperCase())}/preview`);
    };
    return <div className="workspace-shell" ref={root} onKeyDown={event => {
        if (event.key === 'Escape') root.current?.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(detail => { detail.open = false; detail.querySelector<HTMLElement>('summary')?.focus(); });
    }}>
        <header className="workspace-header">
            <a className="public-skip" href="#main-content">Skip to content</a>
            <Link className="workspace-brand" to="/app" aria-label="QS-VC meetings"><BrandLogo /></Link>
            <nav className="workspace-navigation" aria-label="Workspace"><Link to="/app" aria-current="page">Meetings</Link><Link to="/schedule">Schedule</Link><Link to="/schedule?type=webinar">Town halls</Link></nav>
            <details className="workspace-account">
                <summary aria-label="Your account"><span className="workspace-account-initial" aria-hidden="true">{profile?.displayName.trim().charAt(0).toUpperCase() || 'Q'}</span></summary>
                <div className="workspace-dropdown"><ThemeSelect /><p>{profile?.displayName || (profileError ? 'Account unavailable' : 'Loading account…')}</p>{profile && <span>{profile.email}</span>}{profileError && <button className="qsvc-action qsvc-action--secondary" onClick={() => void refreshSession()}><ActionContents>Retry account</ActionContents></button>}<Link to="/">Visit website<span className="mi" aria-hidden="true">north_east</span></Link><button disabled={signingOut} onClick={onSignOut}>{signingOut ? 'Signing out…' : 'Sign out'}<span className="mi" aria-hidden="true">logout</span></button></div>
            </details>
        </header>
        {joinError && <p role="alert" id="workspace-join-error" className="workspace-alert">{joinError}</p>}
        {sessionError && <p role="alert" className="workspace-alert">{sessionError}</p>}
        <div className="workspace-body">
            <aside className="workspace-start" aria-label="Start or join a meeting">
                <p className="workspace-welcome">{profile ? `Welcome back, ${profile.displayName}.` : 'Welcome to QS-VC.'}</p>
                <h1>Your meeting desk.</h1>
                <p className="workspace-start-copy">Start a room, share a link, or join your team.</p>
            <details className="workspace-new">
                <summary className="qsvc-action" aria-busy={creating}><ActionContents><span className="mi" aria-hidden="true">video_call</span>{creating ? 'Creating…' : 'New meeting'}<span className="mi workspace-new-caret" aria-hidden="true">expand_more</span></ActionContents></summary>
                <div className="workspace-dropdown"><button disabled={creating} onClick={() => newAction(() => setSetupAction('link'))}><span className="mi" aria-hidden="true">link</span>Create a link</button><button disabled={creating} onClick={() => newAction(() => setSetupAction('start'))}><span className="mi" aria-hidden="true">videocam</span>Start now</button><button onClick={() => newAction(() => navigate('/schedule'))}><span className="mi" aria-hidden="true">calendar_today</span>Schedule a meeting</button></div>
            </details>
                <div className="workspace-join-section"><p>Have an invitation?</p>
            <form className="workspace-join" onSubmit={joinMeeting}>
                <span className="mi" aria-hidden="true">keyboard</span>
                <label className="workspace-sr" htmlFor="workspace-code">Meeting code or link</label>
                <input id="workspace-code" value={join} onChange={event => setJoin(event.target.value)} placeholder="Enter a code or link" aria-describedby={joinError ? 'workspace-join-error' : undefined} />
                <button type="submit" disabled={!join.trim()} className="qsvc-action"><ActionContents>Join</ActionContents></button>
            </form>
                </div>
                <div className="workspace-preflight"><span className="mi" aria-hidden="true">tune</span><p>Check your camera, microphone and language before joining.</p></div>
            </aside>
            <main id="main-content" className="workspace-main">
                <div className="workspace-views" role="tablist" aria-label="Which meetings to show">
                    <button type="button" role="tab" id="tab-day" aria-selected={view === 'day'} aria-controls="workspace-view-panel" onClick={() => setView('day')}><span className="mi mi-sm" aria-hidden="true">calendar_today</span>By day</button>
                    <button type="button" role="tab" id="tab-hosted" aria-selected={view === 'hosted'} aria-controls="workspace-view-panel" onClick={() => setView('hosted')}><span className="mi mi-sm" aria-hidden="true">shield_person</span>Meetings I host</button>
                </div>
                {view === 'hosted' ? <section id="workspace-view-panel" role="tabpanel" aria-labelledby="tab-hosted" className="workspace-schedule"><div className="workspace-day-heading"><div><h2>Meetings I host</h2><p>Start, share or review the meetings you created.</p></div></div><HostedMeetings onExpired={onExpired} /></section> : <div id="workspace-view-panel" role="tabpanel" aria-labelledby="tab-day">
                <div className="workspace-day-heading"><div><h2>{selected.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}</h2><p>Meetings in your organisation</p></div><div className="workspace-date-actions"><button onClick={() => selectDay(new Date(new Date().setHours(0,0,0,0)))}>Today</button><label className="workspace-date-picker"><span className="workspace-sr">Choose a date</span><input type="date" value={selectedKey} onChange={event => { const parts = event.target.value.split('-').map(Number); if (parts.length === 3 && parts.every(Boolean)) selectDay(new Date(parts[0],parts[1]-1,parts[2])); }} /></label></div></div>
                <div className="workspace-week" aria-label="Choose meeting day"><button className="workspace-week-arrow" aria-label="Previous week" onClick={() => selectDay(moveDay(selected,-7))}><span className="mi" aria-hidden="true">chevron_left</span></button><div className="workspace-days">{Array.from({length:7},(_,index) => { const day = moveDay(monday,index); return <button key={dateKey(day)} aria-label={day.toLocaleDateString(undefined,{weekday:'long',year:'numeric',month:'long',day:'numeric'})} aria-pressed={dateKey(day) === selectedKey} onClick={() => selectDay(day)}><span>{day.toLocaleDateString(undefined,{weekday:'short'})}</span><span>{day.getDate()}</span><i aria-hidden="true" data-today={dateKey(day) === dateKey(new Date())} /></button>; })}</div><button className="workspace-week-arrow" aria-label="Next week" onClick={() => selectDay(moveDay(selected,7))}><span className="mi" aria-hidden="true">chevron_right</span></button></div>
                <section className="workspace-schedule" aria-label="Meetings for the selected date" aria-busy={loading}>
                    {loading && !offset ? <div className="workspace-state" role="status"><span className="mi" aria-hidden="true">calendar_month</span><h2>Loading meetings…</h2><p>Your schedule will appear here.</p></div> : error ? <div className="workspace-state" role="alert"><span className="mi" aria-hidden="true">cloud_off</span><h2>Meetings aren’t available right now</h2><p>{error}</p><button className="qsvc-action qsvc-action--secondary" onClick={() => setRefresh(value => value+1)}><ActionContents>Try again</ActionContents></button></div> : !meetings.length ? <div className="workspace-state"><div className="workspace-empty-calendar" aria-hidden="true"><span className="mi">event_available</span><i /></div><h2>No meetings on this day</h2><p>Set aside time for your next conversation.</p><Link className="qsvc-action" to="/schedule"><ActionContents><span className="mi" aria-hidden="true">add</span>Schedule a meeting</ActionContents></Link></div> : <><div className="workspace-list" key={selectedKey}>{meetings.map(meeting => <article className="workspace-meeting-row" data-status={meeting.status} key={meeting.id}><time dateTime={meeting.scheduledStart || meeting.createdAt}>{new Date(meeting.scheduledStart || meeting.createdAt).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}</time><div><h2>{meeting.title || 'Untitled meeting'}</h2><p><span className="workspace-code">{meeting.meetingCode}</span><span className="workspace-status">{meeting.status === 'active' ? 'In progress' : meeting.status === 'ended' ? 'Ended' : meeting.status === 'cancelled' ? 'Cancelled' : 'Scheduled'}</span>{meeting.isHost && <span className="workspace-host-badge"><span className="mi" aria-hidden="true">shield_person</span>You host</span>}</p></div><div className="workspace-row-actions"><Link className="workspace-row-join workspace-row-secondary" to={`/recordings/${encodeURIComponent(meeting.meetingCode)}`}>Recordings</Link>{meeting.canCancel && meeting.scheduledStart && meeting.status === 'waiting' && <CancelScheduledMeeting
                    id={meeting.id} title={meeting.title || meeting.meetingCode} onExpired={onExpired}
                    onCancelled={() => setMeetings(items => items.map(item => item.id === meeting.id ? { ...item, status: 'cancelled' } : item))} />}
                    {meeting.status !== 'ended' && meeting.status !== 'cancelled' && <Link className="workspace-row-join qsvc-action" to={`/meeting/${encodeURIComponent(meeting.meetingCode)}/preview`}><ActionContents>Join</ActionContents></Link>}</div></article>)}</div>{more && <button className="workspace-load-more qsvc-action qsvc-action--secondary" disabled={loading} onClick={() => setOffset(value => value+50)}><ActionContents>{loading ? 'Loading…' : 'Load more meetings'}</ActionContents></button>}</>}
                </section>
                </div>}
            </main>
        </div>
        {setupAction && <MeetingSetupDialog action={setupAction} creating={creating} onClose={() => setSetupAction(null)} onCreate={onCreate} />}
    </div>;
}
