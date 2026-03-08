import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

const RECORDING_URL = import.meta.env.VITE_RECORDING_URL || 'http://localhost:4004';

interface RecordingData {
    id: string;
    meetingCode: string;
    filename: string;
    duration: string;
    size: string;
    format: string;
    url: string;
    createdAt: string;
}

export default function RecordingPlayback() {
    const { meetingId } = useParams<{ meetingId: string }>();
    const navigate = useNavigate();
    const [recordings, setRecordings] = useState<RecordingData[]>([]);
    const [selectedIdx, setSelectedIdx] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        async function fetchRecordings() {
            try {
                const res = await fetch(`${RECORDING_URL}/api/recordings/${meetingId}`, {
                    headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
                });
                if (!res.ok) throw new Error('Failed to fetch recordings');
                const data = await res.json();
                setRecordings(data.recordings || []);
            } catch (err: any) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        }
        fetchRecordings();
    }, [meetingId]);

    const selected = recordings[selectedIdx];

    return (
        <div className="recording-page">
            <div className="recording-header">
                <button className="btn-back" onClick={() => navigate(-1)}>
                    <span className="mi mi-sm">arrow_back</span> Back
                </button>
                <h1>
                    <span className="mi" style={{ color: 'var(--accent-primary)', verticalAlign: 'middle', marginRight: '8px' }}>play_circle</span>
                    Recordings
                </h1>
            </div>

            {loading && <div className="recording-loading"><span className="spinner" /> Loading recordings...</div>}
            {error && <div className="recording-error"><span className="mi mi-sm" style={{ verticalAlign: 'middle', marginRight: '6px' }}>error</span>{error}</div>}

            {!loading && recordings.length === 0 && !error && (
                <div className="recording-empty">
                    <span className="mi" style={{ fontSize: '48px', opacity: 0.3, display: 'block', marginBottom: '12px' }}>videocam_off</span>
                    <p>No recordings found for this meeting.</p>
                </div>
            )}

            {recordings.length > 0 && selected && (
                <div className="recording-layout">
                    <div className="recording-player">
                        <video
                            src={selected.url}
                            controls
                            className="recording-video"
                        />
                        <div className="recording-info">
                            <h3>{selected.filename || `Recording ${selectedIdx + 1}`}</h3>
                            <p>
                                <span className="mi mi-sm" style={{ verticalAlign: 'middle', marginRight: '4px' }}>schedule</span>
                                {selected.duration} &nbsp;·&nbsp;
                                <span className="mi mi-sm" style={{ verticalAlign: 'middle', marginRight: '4px' }}>storage</span>
                                {selected.size} &nbsp;·&nbsp;
                                {selected.format?.toUpperCase()}
                            </p>
                            <a href={selected.url} download className="btn-download">
                                <span className="mi mi-sm">download</span>
                                Download
                            </a>
                        </div>
                    </div>

                    {recordings.length > 1 && (
                        <div className="recording-list">
                            <h3>All Recordings ({recordings.length})</h3>
                            <ul>
                                {recordings.map((r, i) => (
                                    <li
                                        key={r.id}
                                        className={`recording-item ${i === selectedIdx ? 'active' : ''}`}
                                        onClick={() => setSelectedIdx(i)}
                                    >
                                        <span className="mi mi-sm">play_circle</span>
                                        <div>
                                            <div style={{ fontWeight: 500, color: 'var(--text-primary)', marginBottom: '2px' }}>
                                                {r.filename || `Recording ${i + 1}`}
                                            </div>
                                            <div style={{ fontSize: '11px' }}>{r.duration} · {r.size}</div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
