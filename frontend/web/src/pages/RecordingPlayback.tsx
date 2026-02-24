/**
 * Recording Playback Page — View and download meeting recordings.
 */
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

interface Recording {
    id: string;
    meetingId: string;
    meetingCode: string;
    startedAt: string;
    endedAt: string;
    duration: string;
    size: string;
    downloadUrl: string;
    status: string;
}

const RECORDING_SERVICE = import.meta.env.VITE_RECORDING_URL || 'http://localhost:4004';

const RecordingPlayback: React.FC = () => {
    const { meetingId } = useParams<{ meetingId: string }>();
    const navigate = useNavigate();
    const [recordings, setRecordings] = useState<Recording[]>([]);
    const [selectedRecording, setSelectedRecording] = useState<Recording | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchRecordings = async () => {
            try {
                const res = await fetch(`${RECORDING_SERVICE}/api/recordings/meeting/${meetingId}`);
                if (!res.ok) throw new Error('Failed to fetch recordings');
                const data = await res.json();
                setRecordings(data.recordings || []);
                if (data.recordings?.length > 0) {
                    setSelectedRecording(data.recordings[0]);
                }
            } catch (err: any) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        if (meetingId) fetchRecordings();
    }, [meetingId]);

    const formatDuration = (seconds: string) => {
        const s = parseInt(seconds, 10);
        const hrs = Math.floor(s / 3600);
        const mins = Math.floor((s % 3600) / 60);
        const secs = s % 60;
        return [hrs, mins, secs].map(v => v.toString().padStart(2, '0')).join(':');
    };

    const formatSize = (bytes: string) => {
        const b = parseInt(bytes, 10);
        if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
        if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
        return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    };

    if (loading) {
        return (
            <div className="recording-page">
                <div className="recording-loading">Loading recordings...</div>
            </div>
        );
    }

    return (
        <div className="recording-page">
            <div className="recording-header">
                <button className="btn-back" onClick={() => navigate(-1)}>← Back</button>
                <h1>Meeting Recordings</h1>
            </div>

            {error && <div className="recording-error">{error}</div>}

            <div className="recording-layout">
                {/* Player */}
                <div className="recording-player">
                    {selectedRecording ? (
                        <>
                            <video
                                controls
                                autoPlay={false}
                                className="recording-video"
                                src={selectedRecording.downloadUrl}
                            />
                            <div className="recording-info">
                                <h3>{selectedRecording.meetingCode}</h3>
                                <p>
                                    {new Date(selectedRecording.startedAt).toLocaleString()} ·{' '}
                                    {formatDuration(selectedRecording.duration)} ·{' '}
                                    {formatSize(selectedRecording.size)}
                                </p>
                                <a
                                    href={selectedRecording.downloadUrl}
                                    download
                                    className="btn-download"
                                >
                                    ⬇ Download
                                </a>
                            </div>
                        </>
                    ) : (
                        <div className="recording-empty">No recordings available</div>
                    )}
                </div>

                {/* Recording list */}
                {recordings.length > 1 && (
                    <div className="recording-list">
                        <h3>All Recordings ({recordings.length})</h3>
                        <ul>
                            {recordings.map((r) => (
                                <li
                                    key={r.id}
                                    className={`recording-item ${r.id === selectedRecording?.id ? 'active' : ''}`}
                                    onClick={() => setSelectedRecording(r)}
                                >
                                    <span className="recording-item-date">
                                        {new Date(r.startedAt).toLocaleDateString()}
                                    </span>
                                    <span className="recording-item-duration">
                                        {formatDuration(r.duration)}
                                    </span>
                                    <span className="recording-item-size">
                                        {formatSize(r.size)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </div>
    );
};

export default RecordingPlayback;
