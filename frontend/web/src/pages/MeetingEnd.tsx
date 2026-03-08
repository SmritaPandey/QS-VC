import { useNavigate, useParams, useLocation } from 'react-router-dom';

interface MeetingEndState {
    duration?: number;
    participantCount?: number;
    displayName?: string;
    chatMessageCount?: number;
    participants?: string[];
    meetingCode?: string;
    recordingAvailable?: boolean;
    recordingUrl?: string;
}

export default function MeetingEnd() {
    const navigate = useNavigate();
    const location = useLocation();
    const { meetingCode } = useParams<{ meetingCode: string }>();
    const state = (location.state as MeetingEndState) || {};

    const formatDuration = (s: number) => {
        if (!s) return '0m';
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };

    return (
        <div className="meeting-end-page">
            <div className="meeting-end-card">
                <div className="meeting-end-icon">
                    <span className="mi" style={{ fontSize: '32px' }}>check</span>
                </div>
                <h1>Meeting Ended</h1>
                <p className="meeting-code">{meetingCode || state.meetingCode || 'Meeting'}</p>

                <div className="meeting-end-stats">
                    <div className="stat-item">
                        <span className="stat-value">{formatDuration(state.duration || 0)}</span>
                        <span className="stat-label">Duration</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-value">{state.participantCount || 1}</span>
                        <span className="stat-label">Participants</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-value">{state.chatMessageCount || 0}</span>
                        <span className="stat-label">Messages</span>
                    </div>
                </div>

                {state.participants && state.participants.length > 0 && (
                    <div className="meeting-end-participants">
                        <h3>Participants</h3>
                        <ul>
                            {state.participants.map((p, i) => (
                                <li key={i}>{p}</li>
                            ))}
                        </ul>
                    </div>
                )}

                {state.recordingAvailable && state.recordingUrl && (
                    <a href={state.recordingUrl} className="btn-download-recording" download>
                        <span className="mi mi-sm">download</span>
                        Download Recording
                    </a>
                )}

                <div className="meeting-end-actions">
                    <button className="btn-new-meeting" onClick={() => navigate('/')}>
                        <span className="mi mi-sm" style={{ verticalAlign: 'middle', marginRight: '6px' }}>videocam</span>
                        New Meeting
                    </button>
                    <button className="btn-rejoin" onClick={() => navigate('/')}>
                        <span className="mi mi-sm" style={{ verticalAlign: 'middle', marginRight: '6px' }}>arrow_back</span>
                        Home
                    </button>
                </div>
            </div>
        </div>
    );
}
