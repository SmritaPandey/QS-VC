/**
 * Meeting End Summary Page — Shown when a meeting ends.
 * Displays duration, participants, recording link, and meeting stats.
 */
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

interface MeetingSummary {
    meetingCode: string;
    duration: string;
    participants: { displayName: string; joinedAt: string; leftAt: string }[];
    recordingUrl?: string;
    chatMessageCount: number;
}

const MeetingEnd: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const summary = (location.state as MeetingSummary) || {
        meetingCode: 'QS-XXXX-XXXX-XXXX',
        duration: '00:00',
        participants: [],
        chatMessageCount: 0,
    };

    const formatDuration = (dur: string): string => {
        if (dur.includes(':')) return dur;
        const secs = parseInt(dur, 10);
        const hrs = Math.floor(secs / 3600);
        const mins = Math.floor((secs % 3600) / 60);
        const s = secs % 60;
        if (hrs > 0) return `${hrs}h ${mins}m ${s}s`;
        if (mins > 0) return `${mins}m ${s}s`;
        return `${s}s`;
    };

    return (
        <div className="meeting-end-page">
            <div className="meeting-end-card">
                <div className="meeting-end-icon">✓</div>
                <h1>Meeting Ended</h1>
                <p className="meeting-code">{summary.meetingCode}</p>

                <div className="meeting-end-stats">
                    <div className="stat-item">
                        <span className="stat-label">Duration</span>
                        <span className="stat-value">{formatDuration(summary.duration)}</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Participants</span>
                        <span className="stat-value">{summary.participants.length}</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Messages</span>
                        <span className="stat-value">{summary.chatMessageCount}</span>
                    </div>
                </div>

                {summary.participants.length > 0 && (
                    <div className="meeting-end-participants">
                        <h3>Participants</h3>
                        <ul>
                            {summary.participants.map((p, i) => (
                                <li key={i}>
                                    <span className="participant-name">{p.displayName}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {summary.recordingUrl && (
                    <a
                        href={summary.recordingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-download-recording"
                    >
                        ⬇ Download Recording
                    </a>
                )}

                <div className="meeting-end-actions">
                    <button className="btn-new-meeting" onClick={() => navigate('/')}>
                        New Meeting
                    </button>
                    <button className="btn-rejoin" onClick={() => navigate(-1)}>
                        Rejoin
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MeetingEnd;
