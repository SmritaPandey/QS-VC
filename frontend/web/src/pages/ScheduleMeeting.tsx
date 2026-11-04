import { downloadICS, openGoogleCalendar, openOutlookCalendar, type CalendarEvent } from '../lib/calendar-integration';
import { useSession } from '../lib/use-session';
import ThemeSelect from '../components/ThemeSelect';
import ActionContents from '../components/ActionContents';
import { clearSession, getToken, refreshSession } from '../lib/session';
import LoadingMark from '../components/LoadingMark';
/**
 * Meeting Scheduling Page — Schedule future meetings with invitations.
 * Features: date/time picker, participant invitations,
 * meeting settings, and calendar preview.
 */
import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

const MEETING_API = import.meta.env.VITE_API_URL || import.meta.env.VITE_MEETING_URL || '';

type MeetingDuration = 15 | 30 | 45 | 60 | 90 | 120;

interface ScheduleFormData {
    title: string;
    description: string;
    date: string;
    time: string;
    duration: MeetingDuration;
    enableWaitingRoom: boolean;
    webinar: boolean;
    repeat: 'none' | 'daily' | 'weekly';
    repeatCount: number;
    enableE2EE: boolean;
    enableRecording: boolean;
    maxParticipants: number;
    password: string;
    invitees: string[];
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
    const schedulingWebinar = new URLSearchParams(search).get('type') === 'webinar';
    const [submitting, setSubmitting] = useState(false);
    const [scheduled, setScheduled] = useState<(CalendarEvent & { webinar: boolean; occurrences?: { meetingCode: string; scheduledStart: string; scheduledEnd: string }[] }) | null>(null);
    const [inviteInput, setInviteInput] = useState('');
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
        enableWaitingRoom: false,
        webinar: schedulingWebinar,
        repeat: 'none',
        repeatCount: 2,
        enableE2EE: false,
        enableRecording: true,
        maxParticipants: 100,
        password: '',
        invitees: [],
    });

    const updateField = <K extends keyof ScheduleFormData>(key: K, value: ScheduleFormData[K]) => {
        setForm(prev => ({ ...prev, [key]: value }));
    };

    const addInvitee = () => {
        const email = inviteInput.trim().toLowerCase();
        if (email && email.includes('@') && !form.invitees.includes(email)) {
            updateField('invitees', [...form.invitees, email]);
            setInviteInput('');
        }
    };

    const removeInvitee = (email: string) => {
        updateField('invitees', form.invitees.filter(e => e !== email));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        const token = getToken();
        setSubmitting(true);

        const startDateTime = new Date(`${form.date}T${form.time}`);
        const endDateTime = new Date(startDateTime.getTime() + form.duration * 60000);

        try {
            const res = await fetch(`${MEETING_API}/api/meetings/schedule`, {
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
                        waitingRoom: form.enableWaitingRoom,
                        webinar: form.webinar,
                        e2eeRequired: false,
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
            setScheduled({
                title: form.title || 'Scheduled Meeting',
                occurrences: data.occurrences,
                webinar: form.webinar,
                startTime: startDateTime,
                endTime: endDateTime,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                attendees: [],
                reminders: [],
                isPrivate: true,
                meetingCode,
                meetingUrl: `${window.location.origin}/meeting/${meetingCode}/preview`,
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
        return (
            <div className="schedule-page">
                <div className="schedule-container">
                    <div className="schedule-success"><ThemeSelect />
                        <div className="success-icon"><span className="mi" aria-hidden="true">check_circle</span></div>
                        <h1>{scheduled.webinar ? 'Webinar scheduled.' : 'Meeting scheduled.'}</h1>
                        {scheduled.webinar && <p>Share the webinar link with attendees. Signed-out guests need host approval to enter.</p>}
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
                                <span className="detail-value link">{scheduled.meetingUrl}</span>
                            </div>
                            {form.invitees.length > 0 && (
                                <div className="detail-row">
                                    <span className="detail-label">Invited</span>
                                    <span className="detail-value">{form.invitees.length} people</span>
                                </div>
                            )}
                        </div>
                        {scheduled.occurrences && scheduled.occurrences.length > 1 && <section aria-label="Series occurrences">
                            <h2>Series occurrences</h2>
                            <ul>{scheduled.occurrences.map(occurrence => {
                                const meetingUrl = `${window.location.origin}/meeting/${encodeURIComponent(occurrence.meetingCode)}/preview`;
                                const event = {
                                    ...scheduled, meetingCode: occurrence.meetingCode, meetingUrl,
                                    startTime: new Date(occurrence.scheduledStart), endTime: new Date(occurrence.scheduledEnd),
                                };
                                return <li key={occurrence.meetingCode}>
                                    <Link to={new URL(meetingUrl).pathname}>{event.startTime.toLocaleString()}</Link>{' '}
                                    <button type="button" onClick={() => downloadICS(event)}>Download event</button>{' '}
                                    <button type="button" onClick={() => openGoogleCalendar(event)}>Add to Google Calendar</button>{' '}
                                    <button type="button" onClick={() => openOutlookCalendar(event)}>Add to Outlook</button>
                                </li>;
                            })}</ul>
                        </section>}
                        <div className="success-actions">
                            <button type="button" className="qsvc-action qsvc-action--secondary" onClick={() => downloadICS(scheduled)}><ActionContents>Download calendar event</ActionContents></button>
                            {(!scheduled.occurrences || scheduled.occurrences.length <= 1) && <>
                                <button type="button" className="qsvc-action qsvc-action--secondary" onClick={() => openGoogleCalendar(scheduled)}>Add to Google Calendar</button>
                                <button type="button" className="qsvc-action qsvc-action--secondary" onClick={() => openOutlookCalendar(scheduled)}>Add to Outlook</button>
                            </>}
                            <button className="btn-primary qsvc-action" onClick={copyInvitation}><ActionContents><span className="mi" aria-hidden="true">{copySuccess ? 'check' : 'content_copy'}</span>{copySuccess ? 'Copied' : 'Copy invitation'}</ActionContents></button>
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
                    <h1>{schedulingWebinar ? 'Schedule a webinar.' : 'Schedule a meeting.'}</h1>
                    <p>Plan a future meeting and invite participants</p>
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
                        <h2>Invite Participants</h2>
                        <div className="invite-input-row">
                            <input
                                type="email"
                                aria-label="Participant email" placeholder="colleague@company.com"
                                value={inviteInput}
                                onChange={e => setInviteInput(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addInvitee(); } }}
                                className="form-input"
                            />
                            <button type="button" className="btn-add qsvc-action" onClick={addInvitee}><ActionContents>+ Add</ActionContents></button>
                        </div>
                        {form.invitees.length > 0 && (
                            <div className="invitee-list">
                                {form.invitees.map(email => (
                                    <span key={email} className="invitee-chip">
                                        {email}
                                        <button
                                            type="button"
                                            className="chip-remove" aria-label={`Remove ${email}`}
                                            onClick={() => removeInvitee(email)}
                                        >×</button>
                                    </span>
                                ))}
                            </div>
                        )}
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
                        <label className="toggle-label"><input type="checkbox" checked={form.webinar} onChange={event => updateField('webinar', event.target.checked)} />Webinar. Only the organiser can share audio, video, or screen.</label>
                        <div className="settings-grid">
                            <label className="toggle-label">
                                <input
                                    type="checkbox"
                                    checked={form.enableWaitingRoom}
                                    onChange={e => updateField('enableWaitingRoom', e.target.checked)}
                                />
                                <span className="toggle-text">Require host admission</span>
                            </label>
                            <label className="toggle-label">
                                <input
                                    type="checkbox"
                                    checked={false}
                                    disabled
                                    onChange={e => updateField('enableE2EE', e.target.checked)}
                                />
                                <span className="toggle-text">End-to-end encryption unavailable in demo</span>
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
                                {form.invitees.length > 0 && (
                                    <span><span className="mi mi-sm" aria-hidden="true">group</span> {form.invitees.length} invitee{form.invitees.length > 1 ? 's' : ''}</span>
                                )}
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
