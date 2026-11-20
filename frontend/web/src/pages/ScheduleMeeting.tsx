import { readSessionMeetings, rememberGuestHost, scheduledStarts, SCHEDULE_WINDOW_MESSAGE, SCHEDULE_WINDOW_MS, type SessionMeeting, writeSessionMeetings } from '../lib/session-schedule';
import SelectionInput from '../components/SelectionInput';
import { useSession } from '../lib/use-session';
import ThemeSelect from '../components/ThemeSelect';
import ActionContents from '../components/ActionContents';
import { clearSession, getToken, refreshSession } from '../lib/session';
import LoadingMark from '../components/LoadingMark';
import type { MeetingKind } from '../components/MeetingSetupDialog';
/**
 * Meeting Scheduling Page — Schedule future meetings with invitations.
 * Features: date/time picker, participant invitations,
 * meeting settings, and calendar preview.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

const MEETING_API = import.meta.env.VITE_MEETING_URL || import.meta.env.VITE_API_URL || '';
const MEETINGS_ENDPOINT_BASE = MEETING_API.replace(/\/+$/, '');
const ON_PREM = import.meta.env.VITE_DEPLOYMENT === 'onprem';
const MEETINGS_ENDPOINT = MEETINGS_ENDPOINT_BASE.endsWith('/api/meetings') ? MEETINGS_ENDPOINT_BASE : `${MEETINGS_ENDPOINT_BASE}/api/meetings`;

type MeetingDuration = 15 | 30 | 45 | 60 | 90 | 120;

interface ScheduleFormData {
    title: string;
    date: string;
    time: string;
    duration: MeetingDuration;
    enableWaitingRoom: boolean;
    meetingKind: MeetingKind;
    repeat: 'none' | 'daily' | 'weekly';
    repeatCount: number;
    enableE2EE: boolean;
    maxParticipants: number;
}

const durationOptions: { value: MeetingDuration; label: string }[] = [
    { value: 15, label: '15 minutes' },
    { value: 30, label: '30 minutes' },
    { value: 45, label: '45 minutes' },
    { value: 60, label: '1 hour' },
    { value: 90, label: '1.5 hours' },
    { value: 120, label: '2 hours' },
];

function localDate(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const ScheduleMeeting: React.FC = () => {
    const navigate = useNavigate();
    const { pathname, search } = useLocation();
    const requestedKind = new URLSearchParams(search).get('meetingKind') || new URLSearchParams(search).get('type');
    const schedulingKind: MeetingKind = requestedKind === 'webinar' || requestedKind === 'town_hall' ? 'town_hall' : requestedKind === 'team' ? 'team' : 'conference';
    const schedulingTownHall = schedulingKind === 'town_hall';
    const pending = useRef(false);
    const confirmation = useRef<HTMLElement>(null);
    const [submitting, setSubmitting] = useState(false);
    const [meetings, setMeetings] = useState<SessionMeeting[]>([]);
    const [newMeetingIds, setNewMeetingIds] = useState<string[]>([]);
    const [copiedId, setCopiedId] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const session = useSession();
    const userId = session.status === 'authenticated' ? session.profile?.id : undefined;
    const guest = !ON_PREM && session.status === 'anonymous';
    const storageId = userId ?? (guest ? 'guest' : undefined);
    const limitedDates = guest || ON_PREM;
    const allowedKind = guest && schedulingKind === 'town_hall' ? 'conference' : schedulingKind;
    useEffect(() => {
        setMeetings([]);
        setNewMeetingIds([]);
        setError('');
        setNotice('');
        if (!storageId) return;
        try { setMeetings(readSessionMeetings(storageId)); }
        catch { setError('Your browser session schedule could not be opened.'); }
    }, [storageId]);

    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [form, setForm] = useState<ScheduleFormData>({
        title: '',
        date: localDate(tomorrow),
        time: '10:00',
        duration: 60,
        enableWaitingRoom: true,
        meetingKind: allowedKind,
        repeat: 'none',
        repeatCount: 2,
        enableE2EE: true,
        maxParticipants: 100,
    });

    const updateField = <K extends keyof ScheduleFormData>(key: K, value: ScheduleFormData[K]) => {
        setForm(prev => ({ ...prev, [key]: value }));
    };
    useEffect(() => {
        setForm(previous => ({ ...previous, meetingKind: allowedKind,
            repeat: limitedDates && previous.repeat === 'weekly' ? 'none' : previous.repeat,
            repeatCount: limitedDates ? Math.min(previous.repeatCount, 3) : previous.repeatCount,
        }));
    }, [allowedKind, limitedDates]);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        const token = getToken();
        if (pending.current || !storageId) return;
        if (!guest && !token) { setError('Your session expired. Sign in to schedule this meeting.'); return; }
        pending.current = true;
        setError('');
        setNotice('');
        setSubmitting(true);

        const title = form.title.trim() || 'Scheduled Meeting';
        const start = new Date(`${form.date}T${form.time}`).getTime();
        const count = form.repeat === 'none' ? 1 : form.repeatCount;
        try {
            // Validate storage access before consuming any of the account's weekly quota.
            writeSessionMeetings(storageId, readSessionMeetings(storageId));
            if (limitedDates) scheduledStarts(start, count);
            else if (!Number.isFinite(start) || start <= Date.now()) throw new Error('Choose a future start time.');
            const res = await fetch(`${MEETINGS_ENDPOINT}/schedule`, {
                method: 'POST',
                signal: AbortSignal.timeout(15000),
                headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                body: JSON.stringify({
                    type: 'scheduled',
                    scheduledStart: new Date(start).toISOString(),
                    scheduledEnd: new Date(start + form.duration * 60_000).toISOString(),
                    recurrence: form.repeat === 'none' ? undefined : { frequency: form.repeat, count },
                    settings: {
                        maxParticipants: form.maxParticipants,
                        meetingKind: guest && form.meetingKind === 'conference' ? undefined : form.meetingKind,
                        e2eeRequired: form.enableE2EE,
                    },
                }),
            });
            if (getToken() !== token) return;
            if (res.status === 401) { clearSession(token); return; }
            const data = await res.json().catch(() => null);
            if (getToken() !== token) return;
            if (!res.ok) throw new Error(data?.error || 'Could not schedule the meeting. Try again.');
            if (!Array.isArray(data?.occurrences) || data.occurrences.length !== count) throw new Error('QS-VC could not confirm the schedule. Try again.');
            const added = data.occurrences.map((item: { meetingCode: string; scheduledStart: string; inviteToken: string; guestHostToken?: string }): SessionMeeting => {
                if (guest) {
                    if (!item.guestHostToken) throw new Error('Could not save guest host access.');
                    rememberGuestHost(item.meetingCode, item.guestHostToken);
                }
                return {
                    id: item.meetingCode, title, start: item.scheduledStart, duration: form.duration, meetingKind: form.meetingKind,
                    previewPath: `/meeting/${encodeURIComponent(item.meetingCode)}/preview?invite=${encodeURIComponent(item.inviteToken)}`,
                };
            });
            const next = [...readSessionMeetings(storageId), ...added].sort((a, b) => a.start.localeCompare(b.start));
            writeSessionMeetings(storageId, next);
            setMeetings(next);
            setNewMeetingIds(added.map((meeting: SessionMeeting) => meeting.id));
            requestAnimationFrame(() => confirmation.current?.focus());
            setNotice(added.length === 1 ? 'Meeting scheduled in this tab.' : `${added.length} meetings scheduled in this tab.`);
        } catch (error) {
            setError(error instanceof DOMException && error.name === 'TimeoutError'
                ? 'Scheduling took too long. Check your connection and try again.'
                : error instanceof Error ? error.message : 'Could not save the schedule in this tab.');
        } finally {
            pending.current = false;
            setSubmitting(false);
        }
    };

    const removeMeeting = (id: string) => {
        if (!storageId) return;
        try {
            const next = readSessionMeetings(storageId).filter(meeting => meeting.id !== id);
            writeSessionMeetings(storageId, next);
            setMeetings(next);
            setNotice('Removed from this tab. Any previously shared link can still be opened until it expires.');
        } catch { setError('Could not remove this meeting from the browser session.'); }
    };

    const copyInvitation = async (meeting: SessionMeeting) => {
        try {
            await navigator.clipboard.writeText(`${window.location.origin}${meeting.previewPath}`);
            setCopiedId(meeting.id);
        } catch { setError('Could not copy the invitation. Open its link and copy the address.'); }
    };

    // ━━━ SIGN-IN PROMPT (guests) ━━━
    if (!storageId && session.status !== 'anonymous') return <div className="schedule-page"><div className="schedule-container"><section className="schedule-signin" role="status"><ThemeSelect /><h1>{session.status === 'checking' ? 'Checking account…' : 'Account unavailable'}</h1>{session.status === 'unavailable' && <button type="button" onClick={() => void refreshSession()}>Try again</button>}<Link to="/app">Open meeting app</Link></section></div></div>;

    if (!storageId) {
        const next = encodeURIComponent(pathname + search);
        return (
            <div className="schedule-page">
                <div className="schedule-container">
                    <section className="schedule-signin" aria-labelledby="schedule-signin-title"><ThemeSelect />
                        <div className="schedule-signin-icon"><span className="mi" aria-hidden="true">event_available</span></div>
                        <h1 id="schedule-signin-title">Sign in to schedule a meeting.</h1>
                        <p>Schedule a meeting in this tab and share a private invitation. Guests can open your link and ask to join.</p>
                        <div className="schedule-signin-actions">
                            <Link className="public-primary qsvc-action" to={`/login?next=${next}`}><ActionContents><span className="mi" aria-hidden="true">login</span>Sign in</ActionContents></Link>
                            <Link className="btn-secondary qsvc-action qsvc-action--secondary" to={`/signup?next=${next}`}><ActionContents>Create a free account</ActionContents></Link>
                        </div>
                        <Link className="schedule-signin-guest" to="/app">Join a meeting as a guest instead</Link>
                    </section>
                </div>
            </div>
        );
    }

    // ━━━ SCHEDULING FORM ━━━
    return (
        <div className="schedule-page schedule-editor">
            <div className="schedule-container">
                <header className="schedule-header"><ThemeSelect />
                    <button className="btn-back qsvc-action qsvc-action--secondary" onClick={() => navigate('/app')}><ActionContents><span className="mi" aria-hidden="true">arrow_back</span> Back to meetings</ActionContents></button>
                    <h1>{schedulingTownHall && !guest ? 'Schedule a town hall' : 'Schedule a meeting'}</h1>
                    <p>{limitedDates ? 'Schedule within the next 72 hours.' : 'Schedule up to seven meetings in a rolling week across devices.'} Your schedule stays in this browser tab and clears when the session ends.</p>
                    {meetings.length > 0 && <a href="#session-schedule-title">View meetings scheduled in this tab</a>}
                </header>

                <form onSubmit={handleSubmit} className="schedule-form schedule-composer">
                    <div className="schedule-fields">
                    {/* ── Meeting Info ── */}
                    <section className="form-section">
                        <h2>Meeting details</h2>
                        <div className="form-group">
                            <label htmlFor="title">Meeting title</label>
                            <input
                                id="title"
                                type="text"
                                placeholder="Weekly Team Standup"
                                value={form.title}
                                onChange={e => updateField('title', e.target.value)}
                                className="form-input"
                                maxLength={255}
                            />
                        </div>
                        <fieldset className="schedule-kind-options">
                            <legend>Meeting type</legend>
                            {([
                                ['conference', guest ? 'Instant meeting' : 'Conferencing', 'A standard room for a conversation or collaboration.'],
                                ['team', 'Team meeting', 'A working session for your team.'],
                                ['town_hall', 'Town hall', 'A presentation-style room with a stage.'],
                            ] as const).filter(([kind]) => !guest || kind !== 'town_hall').map(([kind, label, detail]) => <label key={kind} className="schedule-kind-option" data-selected={form.meetingKind === kind}>
                                <SelectionInput type="radio" name="schedule-meeting-kind" value={kind} checked={form.meetingKind === kind} onChange={() => updateField('meetingKind', kind)} />
                                <span><strong>{label}</strong><small>{detail}</small></span>
                            </label>)}
                        </fieldset>
                    </section>

                    {/* ── Date & Time ── */}
                    <section className="form-section">
                        <h2>When</h2>
                        <p>{limitedDates ? SCHEDULE_WINDOW_MESSAGE : 'Choose a future start. Each repeat counts toward your weekly limit.'}</p>
                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="date">Date</label>
                                <input
                                    id="date"
                                    type="date"
                                    value={form.date}
                                    onChange={e => updateField('date', e.target.value)}
                                    className="form-input"
                                    min={localDate(now)}
                                    max={limitedDates ? localDate(new Date(now.getTime() + SCHEDULE_WINDOW_MS)) : undefined}
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="time">Time</label>
                                <input
                                    id="time"
                                    type="time"
                                    value={form.time}
                                    onChange={e => updateField('time', e.target.value)}
                                    className="form-input"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="duration">Duration</label>
                                <select
                                    id="duration"
                                    value={form.duration}
                                    onChange={e => updateField('duration', Number(e.target.value) as MeetingDuration)}
                                    className="form-input"
                                >
                                    {durationOptions.map(d => (
                                        <option key={d.value} value={d.value}>{d.label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                    </section>

                    {/* ── Settings ── */}
                    <details className="form-section schedule-options" onInvalidCapture={event => { event.currentTarget.open = true; }}>
                        <summary>Meeting options</summary>
                        <div className="form-group">
                            <label htmlFor="meeting-repeat">Repeat</label>
                            <select id="meeting-repeat" className="form-input" value={form.repeat} onChange={event => updateField('repeat', event.target.value as ScheduleFormData['repeat'])}>
                                <option value="none">Does not repeat</option>
                                <option value="daily">Daily</option>
                                {!limitedDates && <option value="weekly">Weekly</option>}
                            </select>
                            {form.repeat !== 'none' && <>
                                <label htmlFor="meeting-repeat-count">Number of meetings</label>
                                <input id="meeting-repeat-count" className="form-input" type="number" required min={2} max={limitedDates ? 3 : 7} value={form.repeatCount} onChange={event => updateField('repeatCount', event.target.valueAsNumber)} />
                                <p>Occurrences repeat at the same UTC time.</p>
                            </>}
                        </div>
                        <div className="settings-grid">
                            <label className="toggle-label">
                                <SelectionInput type="checkbox" checked={form.enableWaitingRoom} disabled aria-describedby="schedule-waiting-room-note" />
                                <span className="toggle-text">Waiting room required</span>
                            </label>
                            <label className="toggle-label">
                                <SelectionInput
                                    type="checkbox"
                                    checked={form.enableE2EE}
                                    onChange={e => updateField('enableE2EE', e.target.checked)}
                                />
                                <span className="toggle-text">Post-quantum end-to-end encryption (ML-KEM-1024 / ML-DSA-87)</span>
                            </label>
                        </div>
                        <p id="schedule-waiting-room-note" className="schedule-share-note">The host starts the meeting. Unsigned guests then wait for admission.</p>

                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="maxParticipants">Max Participants</label>
                                <input
                                    id="maxParticipants"
                                    type="number"
                                    min={2}
                                    max={500}
                                    value={form.maxParticipants}
                                    onChange={e => updateField('maxParticipants', parseInt(e.target.value) || 100)}
                                    className="form-input"
                                />
                            </div>
                        </div>
                    </details>
                    </div>

                    <aside className="form-section calendar-preview schedule-review">
                        <h2>Invitation preview</h2>
                        <div className="preview-card">
                            <div className="preview-title">{form.title.trim() || 'Scheduled Meeting'}</div>
                            <div className="preview-meta">
                                <span><span className="mi mi-sm" aria-hidden="true">calendar_today</span> {form.date && form.time ? new Date(`${form.date}T${form.time}`).toLocaleDateString(undefined, {
                                    weekday: 'long', month: 'long', day: 'numeric'
                                }) : 'Select date'}</span>
                                <span><span className="mi mi-sm" aria-hidden="true">schedule</span> {form.time} ({form.duration} min)</span>
                                <span><span className="mi mi-sm" aria-hidden="true">groups</span> {form.meetingKind === 'town_hall' ? 'Town hall' : form.meetingKind === 'team' ? 'Team meeting' : guest ? 'Instant meeting' : 'Conferencing'}</span>
                                {form.enableE2EE && <span><span className="mi mi-sm" aria-hidden="true">lock</span> E2EE</span>}
                                {form.enableWaitingRoom && <span>Waiting room enabled</span>}
                            </div>
                        </div>
                    <p className="schedule-share-note">After scheduling, copy the private link to share with attendees. The link expires 24 hours after the scheduled start.</p>
                    <button
                        type="submit"
                        className="btn-primary btn-schedule qsvc-action"
                        disabled={submitting || !form.date || !form.time}
                        aria-describedby={error ? 'schedule-error' : undefined}
                    ><ActionContents>{submitting ? (
                            <LoadingMark label="Scheduling meeting…" />
                        ) : (
                            <><span className="mi" aria-hidden="true">calendar_today</span> Schedule meeting</>
                        )}</ActionContents></button>
                    {error && <p id="schedule-error" className="schedule-error" role="alert">{error}</p>}
                    </aside>
                </form>
                {meetings.length > 0 && <section ref={confirmation} tabIndex={-1} className="form-section schedule-saved" aria-labelledby="session-schedule-title">
                    <h2 id="session-schedule-title">Scheduled in this tab</h2>
                    {notice && <p role="status" className="schedule-confirmation">{notice}</p>}
                    {meetings.map(meeting => {
                        const expired = Date.now() >= Date.parse(meeting.start) + 86_400_000;
                        return <article className="preview-card" data-new={newMeetingIds.includes(meeting.id)} key={meeting.id}>
                            <h3>{meeting.title}</h3>
                            <p><time dateTime={meeting.start}>{new Date(meeting.start).toLocaleString()}</time> · {meeting.duration} minutes · {meeting.meetingKind === 'town_hall' ? 'Town hall' : meeting.meetingKind === 'team' ? 'Team meeting' : guest ? 'Instant meeting' : 'Conferencing'}</p>
                            <div className="success-actions">
                                {expired ? <span>Invitation expired</span> : <>
                                    <Link state={{ title: meeting.title }} to={meeting.previewPath} className="public-primary qsvc-action"><ActionContents>Open meeting</ActionContents></Link>
                                    <button type="button" className="qsvc-action qsvc-action--secondary" onClick={() => void copyInvitation(meeting)}><ActionContents>{copiedId === meeting.id ? 'Link copied' : 'Copy link'}</ActionContents></button>
                                </>}
                                <button type="button" className="qsvc-action qsvc-action--secondary" onClick={() => removeMeeting(meeting.id)}><ActionContents>Remove from this tab</ActionContents></button>
                            </div>
                        </article>;
                    })}
                </section>}
            </div>
        </div>
    );
};

export default ScheduleMeeting;
