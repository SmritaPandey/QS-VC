/**
 * Meeting Scheduling Page — Schedule future meetings with invitations.
 * Features: date/time picker, recurrence selector, participant invitations,
 * meeting settings, and calendar preview.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const MEETING_API = import.meta.env.VITE_MEETING_URL || 'http://localhost:4003';

type RecurrenceType = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly';
type MeetingDuration = 15 | 30 | 45 | 60 | 90 | 120;

interface ScheduleFormData {
    title: string;
    description: string;
    date: string;
    time: string;
    duration: MeetingDuration;
    recurrence: RecurrenceType;
    recurrenceEnd: string;
    enableWaitingRoom: boolean;
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

const recurrenceOptions: { value: RecurrenceType; label: string }[] = [
    { value: 'none', label: 'Does not repeat' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'biweekly', label: 'Every 2 weeks' },
    { value: 'monthly', label: 'Monthly' },
];

const ScheduleMeeting: React.FC = () => {
    const navigate = useNavigate();
    const [submitting, setSubmitting] = useState(false);
    const [scheduled, setScheduled] = useState<{ meetingCode: string; meetingUrl: string } | null>(null);
    const [inviteInput, setInviteInput] = useState('');
    const [copySuccess, setCopySuccess] = useState(false);

    // Default to tomorrow at 10:00
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [form, setForm] = useState<ScheduleFormData>({
        title: '',
        description: '',
        date: tomorrow.toISOString().split('T')[0],
        time: '10:00',
        duration: 60,
        recurrence: 'none',
        recurrenceEnd: '',
        enableWaitingRoom: false,
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
        setSubmitting(true);

        const startDateTime = new Date(`${form.date}T${form.time}`);
        const endDateTime = new Date(startDateTime.getTime() + form.duration * 60000);

        try {
            const res = await fetch(`${MEETING_API}/api/meetings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: form.title || 'Scheduled Meeting',
                    type: form.recurrence !== 'none' ? 'recurring' : 'scheduled',
                    scheduledStart: startDateTime.toISOString(),
                    scheduledEnd: endDateTime.toISOString(),
                    settings: {
                        maxParticipants: form.maxParticipants,
                        waitingRoom: form.enableWaitingRoom,
                        e2eeRequired: form.enableE2EE,
                        recordingAllowed: form.enableRecording,
                        chatEnabled: true,
                        screenShareEnabled: true,
                    },
                }),
            });

            if (!res.ok) throw new Error('Failed to schedule');
            const data = await res.json();

            setScheduled({
                meetingCode: data.meetingCode || data.code || 'SCHEDULED',
                meetingUrl: `${window.location.origin}/meeting/${data.meetingCode || data.code}/preview`,
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

    // ━━━ CONFIRMATION VIEW ━━━
    if (scheduled) {
        return (
            <div className="schedule-page">
                <div className="schedule-container">
                    <div className="schedule-success">
                        <div className="success-icon">✅</div>
                        <h1>Meeting Scheduled!</h1>
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
                        <div className="success-actions">
                            <button className="btn-primary" onClick={copyInvitation}>
                                {copySuccess ? '✓ Copied!' : '📋 Copy Invitation'}
                            </button>
                            <button className="btn-secondary" onClick={() => navigate('/')}>
                                ← Back to Home
                            </button>
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
                <header className="schedule-header">
                    <button className="btn-back" onClick={() => navigate('/')}>← Back</button>
                    <h1>📅 Schedule Meeting</h1>
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

                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="recurrence">Repeat</label>
                                <select
                                    id="recurrence"
                                    value={form.recurrence}
                                    onChange={e => updateField('recurrence', e.target.value as RecurrenceType)}
                                    className="form-input"
                                >
                                    {recurrenceOptions.map(r => (
                                        <option key={r.value} value={r.value}>{r.label}</option>
                                    ))}
                                </select>
                            </div>
                            {form.recurrence !== 'none' && (
                                <div className="form-group">
                                    <label htmlFor="recurrenceEnd">Repeat Until</label>
                                    <input
                                        id="recurrenceEnd"
                                        type="date"
                                        value={form.recurrenceEnd}
                                        onChange={e => updateField('recurrenceEnd', e.target.value)}
                                        className="form-input"
                                        min={form.date}
                                    />
                                </div>
                            )}
                        </div>
                    </section>

                    {/* ── Invitations ── */}
                    <section className="form-section">
                        <h2>Invite Participants</h2>
                        <div className="invite-input-row">
                            <input
                                type="email"
                                placeholder="colleague@company.com"
                                value={inviteInput}
                                onChange={e => setInviteInput(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addInvitee(); } }}
                                className="form-input"
                            />
                            <button type="button" className="btn-add" onClick={addInvitee}>
                                + Add
                            </button>
                        </div>
                        {form.invitees.length > 0 && (
                            <div className="invitee-list">
                                {form.invitees.map(email => (
                                    <span key={email} className="invitee-chip">
                                        {email}
                                        <button
                                            type="button"
                                            className="chip-remove"
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
                        <div className="settings-grid">
                            <label className="toggle-label">
                                <input
                                    type="checkbox"
                                    checked={form.enableWaitingRoom}
                                    onChange={e => updateField('enableWaitingRoom', e.target.checked)}
                                />
                                <span className="toggle-text">🚪 Waiting Room</span>
                            </label>
                            <label className="toggle-label">
                                <input
                                    type="checkbox"
                                    checked={form.enableE2EE}
                                    onChange={e => updateField('enableE2EE', e.target.checked)}
                                />
                                <span className="toggle-text">🔐 End-to-End Encryption</span>
                            </label>
                            <label className="toggle-label">
                                <input
                                    type="checkbox"
                                    checked={form.enableRecording}
                                    onChange={e => updateField('enableRecording', e.target.checked)}
                                />
                                <span className="toggle-text">🎥 Allow Recording</span>
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
                        <h2>📅 Preview</h2>
                        <div className="preview-card">
                            <div className="preview-title">{form.title || 'Untitled Meeting'}</div>
                            <div className="preview-meta">
                                <span>📅 {form.date ? new Date(`${form.date}T${form.time}`).toLocaleDateString('en-US', {
                                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                                }) : 'Select date'}</span>
                                <span>🕐 {form.time} ({form.duration} min)</span>
                                {form.recurrence !== 'none' && (
                                    <span>🔁 Repeats {form.recurrence}</span>
                                )}
                                {form.invitees.length > 0 && (
                                    <span>👥 {form.invitees.length} invitee{form.invitees.length > 1 ? 's' : ''}</span>
                                )}
                                {form.enableE2EE && <span>🔐 E2EE</span>}
                                {form.enableWaitingRoom && <span>🚪 Waiting Room</span>}
                            </div>
                        </div>
                    </section>

                    <button
                        type="submit"
                        className="btn-primary btn-schedule"
                        disabled={submitting || !form.date || !form.time}
                    >
                        {submitting ? (
                            <span className="spinner" />
                        ) : (
                            <>📅 Schedule Meeting</>
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default ScheduleMeeting;
