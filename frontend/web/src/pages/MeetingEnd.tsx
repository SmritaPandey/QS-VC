import ThemeSelect from '../components/ThemeSelect';
import ActionContents from '../components/ActionContents';
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
    reason?: string;
    left?: boolean;
    canRejoin?: boolean;
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
            <div className="meeting-end-card"><ThemeSelect />
                <div className="meeting-end-icon">
                    <span className="mi" style={{ fontSize: '32px' }}>check</span>
                </div>
                <h1>{state.left === false ? 'The meeting has ended.' : 'You’ve left the meeting.'}</h1>
                {state.reason && <p className="meeting-end-reason" role="status">{state.reason}</p>}
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
                    <a href={state.recordingUrl} className="btn-download-recording qsvc-action" download><ActionContents><span className="mi mi-sm" aria-hidden="true">download</span>
                        Download recording</ActionContents></a>
                )}

                <div className="meeting-end-actions">
                    {(meetingCode || state.meetingCode) && state.left !== false && state.canRejoin !== false && <button className="btn-rejoin qsvc-action qsvc-action--secondary" onClick={() => navigate(`/meeting/${encodeURIComponent(meetingCode || state.meetingCode || '')}/preview`, { replace: true })}><ActionContents>
                        <span className="mi mi-sm" aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: '6px' }}>replay</span>
                        Rejoin</ActionContents></button>}
                    <button className="btn-new-meeting qsvc-action" onClick={() => navigate('/app', { replace: true })}><ActionContents>
                        <span className="mi mi-sm" aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: '6px' }}>videocam</span>
                        Back to meetings</ActionContents></button>
                </div>
            </div>
        </div>
    );
}
