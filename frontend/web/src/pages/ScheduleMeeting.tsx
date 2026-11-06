import CancelScheduledMeeting from '../components/CancelScheduledMeeting';
import { downloadICS, openGoogleCalendar, openOutlookCalendar, type CalendarEvent } from '../lib/calendar-integration';
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
    description: string;
    date: string;
    time: string;
    duration: MeetingDuration;
    enableWaitingRoom: boolean;
    meetingKind: MeetingKind;
    repeat: 'none' | 'daily' | 'weekly';
    repeatCount: number;
    enableE2EE: boolean;
    enableRecording: boolean;
    maxParticipants: number;
    password: string;
}

const durationOptions: { value: MeetingDuration; label: string }[] = [
    { value: 15, label: '15 minutes' },
    { value: 30, label: '30 minutes' },
    { value: 45, label: '45 minutes' },
    { value: 60, label: '1 hour' },
    { value: 90, label: '1.5 hours' },
    { value: 120, label: '2 hours' },
];

const ScheduleMeeting: React.FC = () => {
    const navigate = useNavigate();
    const { pathname, search } = useLocation();
    const requestedKind = new URLSearchParams(search).get('meetingKind') || new URLSearchParams(search).get('type');
    const schedulingKind: MeetingKind = requestedKind === 'webinar' || requestedKind === 'town_hall' ? 'town_hall' : requestedKind === 'team' ? 'team' : 'conference';
    const schedulingTownHall = schedulingKind === 'town_hall';
    const [submitting, setSubmitting] = useState(false);
    const [cancelledCodes, setCancelledCodes] = useState<string[]>([]);
    const [scheduled, setScheduled] = useState<(CalendarEvent & { id?: string; inviteToken?: string; meetingKind: MeetingKind; occurrences?: { id?: string; meetingCode: string; scheduledStart: string; scheduledEnd: string; inviteToken?: string }[] }) | null>(null);
    const [copySuccess, setCopySuccess] = useState(false);
    // Scheduling saves a meeting to an account, so guests are asked to sign in first.
    const session = useSession();
    const signedIn = session.status === 'authenticated' || Boolean(session.profile);
    useEffect(() => { setScheduled(null); }, [session.profile?.id]);

    // Default to tomorrow at 10:00
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [form, setForm] = useState<ScheduleFormData>({
        title: '',
        description: '',
        date: tomorrow.toISOString().split('T')[0],
        time: '10:00',
        duration: 60,
        enableWaitingRoom: true,
        meetingKind: schedulingKind,
        repeat: 'none',
        repeatCount: 2,
        enableE2EE: true,
        enableRecording: true,
        maxParticipants: 100,
        password: '',
    });

    const updateField = <K extends keyof ScheduleFormData>(key: K, value: ScheduleFormData[K]) => {
        setForm(prev => ({ ...prev, [key]: value }));
    };
    useEffect(() => { setForm(previous => ({ ...previous, meetingKind: schedulingKind })); }, [schedulingKind]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        const token = getToken();
        setSubmitting(true);

        const startDateTime = new Date(`${form.date}T${form.time}`);
        const endDateTime = new Date(startDateTime.getTime() + form.duration * 60000);

        try {
            const res = await fetch(`${MEETINGS_ENDPOINT}/schedule`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    title: form.title || 'Scheduled Meeting',
                    type: 'scheduled',
                    scheduledStart: startDateTime.toISOString(),
                    scheduledEnd: endDateTime.toISOString(),
                    recurrence: form.repeat === 'none' ? undefined : { frequency: form.repeat, count: form.repeatCount },
                    settings: {
                        maxParticipants: form.maxParticipants,
                        meetingKind: form.meetingKind,
                        waitingRoom: true,
                        webinar: form.meetingKind === 'town_hall',
                        e2eeRequired: form.enableE2EE,
                        recordingAllowed: false,
                        chatEnabled: true,
                        screenShareEnabled: true,
                    },
                }),
            });

            if (getToken() !== token) return;
            if (res.status === 401) { clearSession(token); return; }
            if (!res.ok) throw new Error('Failed to schedule');
            const data = await res.json();
            if (getToken() !== token) return;

            const meetingCode = data.meetingCode || data.code;
            if (typeof meetingCode !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(meetingCode)) throw new Error('Invalid meeting code');
            setCancelledCodes([]);
            const inviteToken = typeof data.inviteToken === 'string' ? data.inviteToken : undefined;
            setScheduled({
                id: typeof data.id === 'string' ? data.id : undefined,
                inviteToken,
                title: form.title || 'Scheduled Meeting',
                occurrences: data.occurrences,
                meetingKind: form.meetingKind,
                startTime: startDateTime,
                endTime: endDateTime,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                attendees: [],
                reminders: [],
                isPrivate: true,
                meetingCode,
                meetingUrl: `${window.location.origin}/meeting/${meetingCode}/preview${inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : ''}`,
            });
        } catch (err) {
            console.error('Schedule error:', err);
            alert('Failed to schedule meeting. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    const copyInvitation = () => {
        if (!scheduled) return;
        const text = `You're invited to a meeting!\n\n` +
            `📋 ${form.title || 'Scheduled Meeting'}\n` +
            `📅 ${new Date(`${form.date}T${form.time}`).toLocaleString()}\n` +
            `⏱ ${form.duration} minutes\n` +
            `🔗 ${scheduled.meetingUrl}\n` +
            `📝 Code: ${scheduled.meetingCode}\n` +
            (form.password ? `🔒 Password: ${form.password}\n` : '') +
            `\nPowered by QS-VC`;
        navigator.clipboard.writeText(text);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
    };

    // ━━━ SIGN-IN PROMPT (guests) ━━━
    if (!signedIn && session.status !== 'anonymous') return <div className="schedule-page"><div className="schedule-container"><section className="schedule-signin" role="status"><ThemeSelect /><h1>{session.status === 'checking' ? 'Checking account…' : 'Account unavailable'}</h1>{session.status === 'unavailable' && <button type="button" onClick={() => void refreshSession()}>Try again</button>}<Link to="/app">Open meeting app</Link></section></div></div>;

    if (!signedIn) {
        const next = encodeURIComponent(pathname + search);
        return (
            <div className="schedule-page">
                <div className="schedule-container">
                    <section className="schedule-signin" aria-labelledby="schedule-signin-title"><ThemeSelect />
                        <div className="schedule-signin-icon"><span className="mi" aria-hidden="true">event_available</span></div>
                        <h1 id="schedule-signin-title">Sign in to schedule a meeting.</h1>
                        <p>Scheduled meetings are saved to your account, so you can share the invitation and start the meeting as host. Guests can still join any meeting with a code.</p>
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

    // ━━━ CONFIRMATION VIEW ━━━
    if (scheduled) {
        const firstCancelled = cancelledCodes.includes(scheduled.meetingCode);
        return (
            <div className="schedule-page">
                <div className="schedule-container">
                    <div className="schedule-success"><ThemeSelect />
                        <div className="success-icon"><span className="mi" aria-hidden="true">check_circle</span></div>
                        <h1>{firstCancelled && (!scheduled.occurrences || scheduled.occurrences.length <= 1) ? 'Meeting cancelled.' : scheduled.meetingKind === 'town_hall' ? 'Town hall scheduled.' : 'Meeting scheduled.'}</h1>
                        {cancelledCodes.length > 0 && <p role="status">Cancelled occurrences: {cancelledCodes.length}.</p>}
                        {!firstCancelled && <p>Share the invitation link with attendees. Everyone waits for the host or a co-host to admit them.</p>}
                        <div className="success-details">
                            <div className="detail-row">
                                <span className="detail-label">Title</span>
                                <span className="detail-value">{form.title || 'Scheduled Meeting'}</span>
                            </div>
                            <div className="detail-row">
                                <span className="detail-label">Date & Time</span>
                                <span className="detail-value">
                                    {new Date(`${form.date}T${form.time}`).toLocaleString()}
                                </span>
                            </div>
                            <div className="detail-row">
                                <span className="detail-label">Duration</span>
                                <span className="detail-value">{form.duration} minutes</span>
                            </div>
                            <div className="detail-row">
                                <span className="detail-label">Meeting Code</span>
                                <span className="detail-value code">{scheduled.meetingCode}</span>
                            </div>
                            <div className="detail-row">
                                <span className="detail-label">Link</span>
                                <span className="detail-value link">{firstCancelled ? 'Cancelled' : scheduled.meetingUrl}</span>
                            </div>
                        </div>
                        {scheduled.occurrences && scheduled.occurrences.length > 1 && <section aria-label="Series occurrences">
                            <h2>Series occurrences</h2>
                            <ul>{scheduled.occurrences.map(occurrence => {
                                const meetingUrl = `${window.location.origin}/meeting/${encodeURIComponent(occurrence.meetingCode)}/preview${occurrence.inviteToken ? `?invite=${encodeURIComponent(occurrence.inviteToken)}` : ''}`;
                                const event = {
                                    ...scheduled, meetingCode: occurrence.meetingCode, meetingUrl,
                                    startTime: new Date(occurrence.scheduledStart), endTime: new Date(occurrence.scheduledEnd),
                                };
                                if (cancelledCodes.includes(occurrence.meetingCode)) return <li key={occurrence.meetingCode}>
                                    {event.startTime.toLocaleString()} · Cancelled
                                </li>;
                                return <li key={occurrence.meetingCode}>
                                    <Link to={new URL(meetingUrl).pathname}>{event.startTime.toLocaleString()}</Link>{' '}
                                    <button type="button" onClick={() => downloadICS(event)}>Download event</button>{' '}
                                    <button type="button" onClick={() => openGoogleCalendar(event)}>Add to Google Calendar</button>{' '}
                                    <button type="button" onClick={() => openOutlookCalendar(event)}>Add to Outlook</button>
                                    {occurrence.id && <CancelScheduledMeeting id={occurrence.id}
                                        title={`${scheduled.title} on ${event.startTime.toLocaleString()}`}
                                        onCancelled={() => setCancelledCodes(codes => [...codes, occurrence.meetingCode])} />}
                                </li>;
                            })}</ul>
                        </section>}
                        <div className="success-actions">
                            {!firstCancelled && (!scheduled.occurrences || scheduled.occurrences.length <= 1) && scheduled.id && <CancelScheduledMeeting
                                id={scheduled.id} title={scheduled.title} onCancelled={() => setCancelledCodes([scheduled.meetingCode])} />}
                            {!firstCancelled && <>
                            <button type="button" className="qsvc-action qsvc-action--secondary" onClick={() => downloadICS(scheduled)}><ActionContents>Download calendar event</ActionContents></button>
                            {(!scheduled.occurrences || scheduled.occurrences.length <= 1) && <>
                                <button type="button" className="qsvc-action qsvc-action--secondary" onClick={() => openGoogleCalendar(scheduled)}>Add to Google Calendar</button>
                                <button type="button" className="qsvc-action qsvc-action--secondary" onClick={() => openOutlookCalendar(scheduled)}>Add to Outlook</button>
                            </>}
                            <button className="btn-primary qsvc-action" onClick={copyInvitation}><ActionContents><span className="mi" aria-hidden="true">{copySuccess ? 'check' : 'content_copy'}</span>{copySuccess ? 'Copied' : 'Copy invitation'}</ActionContents></button>
                            </>}
                            <button className="btn-secondary qsvc-action qsvc-action--secondary" onClick={() => navigate('/app')}><ActionContents>
                                Back to meetings</ActionContents></button>
                        </div>
                    </div>
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
                    <p>Plan a future meeting, then share its invitation link.</p>
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
                        <div className="form-group">
                            <label htmlFor="description">Description (optional)</label>
                            <textarea
                                id="description"
                                placeholder="Add an agenda or description..."
                                value={form.description}
                                onChange={e => updateField('description', e.target.value)}
                                className="form-textarea"
                                rows={3}
                                maxLength={2000}
                            />
                        </div>
                        <fieldset className="schedule-kind-options">
                            <legend>Meeting type</legend>
                            {([
                                ['conference', 'Conferencing', 'A standard room for a conversation or collaboration.'],
                                ['team', 'Team meeting', 'A working session for your team.'],
                                ['town_hall', 'Town hall', 'A presentation-style room with a stage.'],
                            ] as const).map(([kind, label, detail]) => <label key={kind} className="schedule-kind-option" data-selected={form.meetingKind === kind}>
                                <input type="radio" name="schedule-meeting-kind" value={kind} checked={form.meetingKind === kind} onChange={() => updateField('meetingKind', kind)} />
                                <span><strong>{label}</strong><small>{detail}</small></span>
                            </label>)}
                        </fieldset>
                    </section>

                    {/* ── Date & Time ── */}
                    <section className="form-section">
                        <h2>When</h2>
                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="date">Date</label>
                                <input
                                    id="date"
                                    type="date"
                                    value={form.date}
                                    onChange={e => updateField('date', e.target.value)}
                                    className="form-input"
                                    min={new Date().toISOString().split('T')[0]}
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
                        <p className="schedule-share-note">We’ll create an invitation link after you schedule. Copy and share it with attendees from the confirmation screen.</p>
                    </section>

                    {/* ── Settings ── */}
                    <section className="form-section">
                        <h2>Meeting Settings</h2>
                        <div className="form-group">
                            <label htmlFor="meeting-repeat">Repeat</label>
                            <select id="meeting-repeat" className="form-input" value={form.repeat} onChange={event => updateField('repeat', event.target.value as ScheduleFormData['repeat'])}>
                                <option value="none">Does not repeat</option>
                                <option value="daily">Daily</option>
                                <option value="weekly">Weekly</option>
                            </select>
                            {form.repeat !== 'none' && <>
                                <label htmlFor="meeting-repeat-count">Number of meetings</label>
                                <input id="meeting-repeat-count" className="form-input" type="number" required min={2} max={12} value={form.repeatCount} onChange={event => updateField('repeatCount', event.target.valueAsNumber)} />
                                <p>Occurrences repeat at the same UTC time.</p>
                            </>}
                        </div>
                        <div className="settings-grid">
                            <label className="toggle-label">
                                <input type="checkbox" checked={form.enableWaitingRoom} disabled aria-describedby="schedule-waiting-room-note" />
                                <span className="toggle-text">Waiting room required</span>
                            </label>
                            <label className="toggle-label">
                                <input
                                    type="checkbox"
                                    checked={form.enableE2EE}
                                    onChange={e => updateField('enableE2EE', e.target.checked)}
                                />
                                <span className="toggle-text">Post-quantum end-to-end encryption (ML-KEM-1024 / ML-DSA-87)</span>
                            </label>
                            <label className="toggle-label">
                                <input
                                    type="checkbox"
                                    checked={false}
                                    disabled
                                    onChange={e => updateField('enableRecording', e.target.checked)}
                                />
                                <span className="toggle-text">Recording disabled for demo</span>
                            </label>
                        </div>
                        <p id="schedule-waiting-room-note" className="schedule-share-note">Attendees stay in the waiting room until the host or a co-host admits them.</p>

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
                            <div className="form-group">
                                <label htmlFor="password">Meeting Password (optional)</label>
                                <input
                                    id="password"
                                    type="text"
                                    placeholder="Leave blank for no password"
                                    value={form.password}
                                    onChange={e => updateField('password', e.target.value)}
                                    className="form-input"
                                    maxLength={50}
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
            </div>
        </div>
    );
};

export default ScheduleMeeting;
