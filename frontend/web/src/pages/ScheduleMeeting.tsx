import { readSessionMeetings, scheduledStarts, SCHEDULE_WINDOW_MESSAGE, SCHEDULE_WINDOW_MS, type SessionMeeting, writeSessionMeetings } from '../lib/session-schedule';
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
import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

const MEETING_API = import.meta.env.VITE_API_URL || import.meta.env.VITE_MEETING_URL || '';
const MEETINGS_ENDPOINT_BASE = MEETING_API.replace(/\/+$/, '');
const MEETINGS_ENDPOINT = MEETINGS_ENDPOINT_BASE.endsWith('/api/meetings') ? MEETINGS_ENDPOINT_BASE : `${MEETINGS_ENDPOINT_BASE}/api/meetings`;

type MeetingDuration = 15 | 30 | 45 | 60 | 90 | 120;

interface ScheduleFormData {
    title: string;
    date: string;
    time: string;
    duration: MeetingDuration;
    enableWaitingRoom: boolean;
    meetingKind: MeetingKind;
    repeat: 'none' | 'daily';
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
    const [submitting, setSubmitting] = useState(false);
    const [meetings, setMeetings] = useState<SessionMeeting[]>([]);
    const [copiedId, setCopiedId] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const session = useSession();
    const userId = session.status === 'authenticated' ? session.profile?.id : undefined;
    useEffect(() => {
        setMeetings([]);
        setError('');
        setNotice('');
        if (!userId) return;
        try { setMeetings(readSessionMeetings(userId)); }
        catch { setError('Your browser session schedule could not be opened.'); }
    }, [userId]);

    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [form, setForm] = useState<ScheduleFormData>({
        title: '',
        date: localDate(tomorrow),
        time: '10:00',
        duration: 60,
        enableWaitingRoom: true,
        meetingKind: schedulingKind,
        repeat: 'none',
        repeatCount: 2,
        enableE2EE: true,
        maxParticipants: 100,
    });

    const updateField = <K extends keyof ScheduleFormData>(key: K, value: ScheduleFormData[K]) => {
        setForm(prev => ({ ...prev, [key]: value }));
    };
    useEffect(() => { setForm(previous => ({ ...previous, meetingKind: schedulingKind })); }, [schedulingKind]);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        const token = getToken();
        if (submitting || !token || !userId) return;
        setError('');
        setNotice('');
        setSubmitting(true);

        const title = form.title.trim() || 'Scheduled Meeting';
        const start = new Date(`${form.date}T${form.time}`).getTime();
        const count = form.repeat === 'daily' ? form.repeatCount : 1;
        try {
            scheduledStarts(start, count);
            const res = await fetch(`${MEETINGS_ENDPOINT}/schedule`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    type: 'scheduled',
                    scheduledStart: new Date(start).toISOString(),
                    scheduledEnd: new Date(start + form.duration * 60_000).toISOString(),
                    recurrence: count > 1 ? { frequency: 'daily', count } : undefined,
                    settings: {
                        maxParticipants: form.maxParticipants,
                        meetingKind: form.meetingKind,
                        e2eeRequired: form.enableE2EE,
                    },
                }),
            });
            if (getToken() !== token) return;
            if (res.status === 401) { clearSession(token); return; }
            const data = await res.json();
            if (getToken() !== token) return;
            if (!res.ok) throw new Error(data.error || 'Could not schedule the meeting. Try again.');
            const added = data.occurrences.map((item: { meetingCode: string; scheduledStart: string; inviteToken: string }): SessionMeeting => ({
                id: item.meetingCode, title, start: item.scheduledStart, duration: form.duration, meetingKind: form.meetingKind,
                previewPath: `/meeting/${encodeURIComponent(item.meetingCode)}/preview?invite=${encodeURIComponent(item.inviteToken)}`,
            }));
            const next = [...readSessionMeetings(userId), ...added].sort((a, b) => a.start.localeCompare(b.start));
            writeSessionMeetings(userId, next);
            setMeetings(next);
            setNotice(added.length === 1 ? 'Meeting scheduled in this tab.' : `${added.length} meetings scheduled in this tab.`);
        } catch (error) {
            setError(error instanceof Error ? error.message : 'Could not save the schedule in this tab.');
        } finally {
            setSubmitting(false);
        }
    };

    const removeMeeting = (id: string) => {
        if (!userId) return;
        try {
            const next = readSessionMeetings(userId).filter(meeting => meeting.id !== id);
            writeSessionMeetings(userId, next);
            setMeetings(next);
            setNotice('Removed from this tab. Any previously shared link can still be opened until it expires.');
        } catch { setError('Could not remove this meeting from the browser session.'); }
    };

    const copyInvitation = async (meeting: SessionMeeting) => {
        try {
            await navigator.clipboard.writeText(`${meeting.title}\n${new Date(meeting.start).toLocaleString()} (${meeting.duration} min)\n${window.location.origin}${meeting.previewPath}`);
            setCopiedId(meeting.id);
        } catch { setError('Could not copy the invitation. Open its link and copy the address.'); }
    };

    // ━━━ SIGN-IN PROMPT (guests) ━━━
    if (!userId && session.status !== 'anonymous') return <div className="schedule-page"><div className="schedule-container"><section className="schedule-signin" role="status"><ThemeSelect /><h1>{session.status === 'checking' ? 'Checking account…' : 'Account unavailable'}</h1>{session.status === 'unavailable' && <button type="button" onClick={() => void refreshSession()}>Try again</button>}<Link to="/app">Open meeting app</Link></section></div></div>;

    if (!userId) {
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
        <div className="schedule-page">
            <div className="schedule-container">
                <header className="schedule-header"><ThemeSelect />
                    <button className="btn-back qsvc-action qsvc-action--secondary" onClick={() => navigate('/app')}><ActionContents><span className="mi" aria-hidden="true">arrow_back</span> Back to meetings</ActionContents></button>
                    <h1>{schedulingTownHall ? 'Schedule a town hall.' : 'Schedule a meeting.'}</h1>
                    <p>Schedule within the next 72 hours. Your schedule stays in this browser tab and clears when the session ends.</p>
                    {meetings.length > 0 && <a href="#session-schedule-title">View meetings scheduled in this tab</a>}
                </header>

                <form onSubmit={handleSubmit} className="schedule-form">
                    {/* ── Meeting Info ── */}
                    <section className="form-section">
                        <h2>Meeting Details</h2>
                        <div className="form-group">
                            <label htmlFor="title">Meeting Title</label>
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
                                ['conference', 'Conferencing', 'A standard room for a conversation or collaboration.'],
                                ['team', 'Team meeting', 'A working session for your team.'],
                                ['town_hall', 'Town hall', 'A presentation-style room with a stage.'],
                            ] as const).map(([kind, label, detail]) => <label key={kind} className="schedule-kind-option" data-selected={form.meetingKind === kind}>
                                <SelectionInput type="radio" name="schedule-meeting-kind" value={kind} checked={form.meetingKind === kind} onChange={() => updateField('meetingKind', kind)} />
                                <span><strong>{label}</strong><small>{detail}</small></span>
                            </label>)}
                        </fieldset>
                    </section>

                    {/* ── Date & Time ── */}
                    <section className="form-section">
                        <h2>When</h2>
                        <p>{SCHEDULE_WINDOW_MESSAGE}</p>
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
                                    max={localDate(new Date(now.getTime() + SCHEDULE_WINDOW_MS))}
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

                    {/* ── Invitations ── */}
                    <section className="form-section">
                        <h2>Share with attendees</h2>
                        <p className="schedule-share-note">Share the private link with your attendees. Guests need approval when they arrive. Invitations expire 24 hours after the scheduled start.</p>
                    </section>

                    {/* ── Settings ── */}
                    <section className="form-section">
                        <h2>Meeting Settings</h2>
                        <div className="form-group">
                            <label htmlFor="meeting-repeat">Repeat</label>
                            <select id="meeting-repeat" className="form-input" value={form.repeat} onChange={event => updateField('repeat', event.target.value as ScheduleFormData['repeat'])}>
                                <option value="none">Does not repeat</option>
                                <option value="daily">Daily</option>
                            </select>
                            {form.repeat !== 'none' && <>
                                <label htmlFor="meeting-repeat-count">Number of meetings</label>
                                <input id="meeting-repeat-count" className="form-input" type="number" required min={2} max={3} value={form.repeatCount} onChange={event => updateField('repeatCount', event.target.valueAsNumber)} />
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
                    </section>

                    {/* ── Calendar Preview ── */}
                    <section className="form-section calendar-preview">
                        <h2>Invitation preview</h2>
                        <div className="preview-card">
                            <div className="preview-title">{form.title || 'Untitled Meeting'}</div>
                            <div className="preview-meta">
                                <span><span className="mi mi-sm" aria-hidden="true">calendar_today</span> {form.date ? new Date(`${form.date}T${form.time}`).toLocaleDateString('en-US', {
                                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                                }) : 'Select date'}</span>
                                <span><span className="mi mi-sm" aria-hidden="true">schedule</span> {form.time} ({form.duration} min)</span>
                                <span><span className="mi mi-sm" aria-hidden="true">groups</span> {form.meetingKind === 'town_hall' ? 'Town hall' : form.meetingKind === 'team' ? 'Team meeting' : 'Conferencing'}</span>
                                {form.enableE2EE && <span><span className="mi mi-sm" aria-hidden="true">lock</span> E2EE</span>}
                                {form.enableWaitingRoom && <span>Waiting room enabled</span>}
                            </div>
                        </div>
                    </section>

                    <button
                        type="submit"
                        className="btn-primary btn-schedule qsvc-action"
                        disabled={submitting || !form.date || !form.time}
                    ><ActionContents>{submitting ? (
                            <LoadingMark label="Scheduling meeting…" />
                        ) : (
                            <><span className="mi" aria-hidden="true">calendar_today</span> Schedule meeting</>
                        )}</ActionContents></button>
                </form>
                {error && <p role="alert">{error}</p>}
                {notice && <p role="status">{notice}</p>}
                {meetings.length > 0 && <section className="form-section" aria-labelledby="session-schedule-title">
                    <h2 id="session-schedule-title">Scheduled in this tab</h2>
                    {meetings.map(meeting => {
                        const expired = Date.now() >= Date.parse(meeting.start) + 86_400_000;
                        return <article className="preview-card" key={meeting.id}>
                            <h3>{meeting.title}</h3>
                            <p><time dateTime={meeting.start}>{new Date(meeting.start).toLocaleString()}</time> · {meeting.duration} minutes · {meeting.meetingKind === 'town_hall' ? 'Town hall' : meeting.meetingKind === 'team' ? 'Team meeting' : 'Conferencing'}</p>
                            <div className="success-actions">
                                {expired ? <span>Invitation expired</span> : <>
                                    <Link to={meeting.previewPath} className="public-primary qsvc-action"><ActionContents>Open meeting</ActionContents></Link>
                                    <button type="button" className="qsvc-action qsvc-action--secondary" onClick={() => void copyInvitation(meeting)}><ActionContents>{copiedId === meeting.id ? 'Copied' : 'Copy invitation'}</ActionContents></button>
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
