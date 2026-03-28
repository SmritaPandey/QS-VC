import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

export default function PreMeeting() {
    const { meetingCode } = useParams<{ meetingCode: string }>();
    const navigate = useNavigate();
    const videoRef = useRef<HTMLVideoElement>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [displayName, setDisplayName] = useState('');
    const [audioMuted, setAudioMuted] = useState(false);
    const [videoOff, setVideoOff] = useState(false);
    const [copied, setCopied] = useState(false);
    const [devices, setDevices] = useState<{
        cameras: MediaDeviceInfo[];
        mics: MediaDeviceInfo[];
        speakers: MediaDeviceInfo[];
    }>({ cameras: [], mics: [], speakers: [] });

    const inviteLink = `${window.location.origin}/meeting/${meetingCode}/preview`;

    useEffect(() => {
        navigator.mediaDevices
            .getUserMedia({ audio: true, video: { width: 1280, height: 720 } })
            .then((s) => {
                setStream(s);
                if (videoRef.current) {
                    videoRef.current.srcObject = s;
                }
            })
            .catch((err) => {
                console.error('Media access denied:', err);
            });

        navigator.mediaDevices.enumerateDevices().then((devs) => {
            setDevices({
                cameras: devs.filter((d) => d.kind === 'videoinput'),
                mics: devs.filter((d) => d.kind === 'audioinput'),
                speakers: devs.filter((d) => d.kind === 'audiooutput'),
            });
        });

        return () => {
            stream?.getTracks().forEach((t) => t.stop());
        };
    }, []);

    useEffect(() => {
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);

    const toggleAudio = () => {
        if (stream) {
            stream.getAudioTracks().forEach((t) => (t.enabled = audioMuted));
            setAudioMuted(!audioMuted);
        }
    };

    const toggleVideo = () => {
        if (stream) {
            stream.getVideoTracks().forEach((t) => (t.enabled = videoOff));
            setVideoOff(!videoOff);
        }
    };

    const handleCopyLink = async () => {
        try {
            await navigator.clipboard.writeText(inviteLink);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = inviteLink;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleJoin = () => {
        const name = displayName.trim() || 'Guest';
        navigate(`/meeting/${meetingCode}`, {
            state: { displayName: name, audioMuted, videoOff },
        });
    };

    return (
        <div className="pre-meeting-page">
            <div className="pre-meeting-container">
                <div className="preview-section">
                    <div className="video-preview-wrapper">
                        <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            className={`video-preview ${videoOff ? 'video-off' : ''}`}
                        />
                        {videoOff && (
                            <div className="video-off-overlay">
                                <div className="avatar-circle">
                                    {(displayName || 'G')[0].toUpperCase()}
                                </div>
                            </div>
                        )}
                        <div className="preview-controls">
                            <button
                                className={`preview-btn ${audioMuted ? 'muted' : ''}`}
                                onClick={toggleAudio}
                                title={audioMuted ? 'Unmute' : 'Mute'}
                            >
                                <span className="mi">{audioMuted ? 'mic_off' : 'mic'}</span>
                            </button>
                            <button
                                className={`preview-btn ${videoOff ? 'muted' : ''}`}
                                onClick={toggleVideo}
                                title={videoOff ? 'Turn on camera' : 'Turn off camera'}
                            >
                                <span className="mi">{videoOff ? 'videocam_off' : 'videocam'}</span>
                            </button>
                        </div>
                    </div>
                </div>

                <div className="join-section">
                    <div className="meeting-info">
                        <span className="mi mi-sm lock-icon">lock</span>
                        <span className="meeting-code-label">{meetingCode}</span>
                    </div>

                    <h2>Ready to join?</h2>

                    {/* Copy Invite Link */}
                    <button
                        className="btn-copy-invite"
                        onClick={handleCopyLink}
                        title="Copy meeting link to share with others"
                    >
                        <span className="mi mi-sm">{copied ? 'done' : 'link'}</span>
                        {copied ? 'Link Copied!' : 'Copy Invite Link'}
                    </button>

                    <input
                        type="text"
                        placeholder="Enter your name"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="input-name"
                        onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                        autoFocus
                    />

                    <div className="device-selectors">
                        <label>
                            <span className="mi mi-sm" style={{ verticalAlign: 'middle', marginRight: '4px' }}>videocam</span>
                            Camera
                            <select className="device-select">
                                {devices.cameras.map((d) => (
                                    <option key={d.deviceId} value={d.deviceId}>
                                        {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            <span className="mi mi-sm" style={{ verticalAlign: 'middle', marginRight: '4px' }}>mic</span>
                            Microphone
                            <select className="device-select">
                                {devices.mics.map((d) => (
                                    <option key={d.deviceId} value={d.deviceId}>
                                        {d.label || `Mic ${d.deviceId.slice(0, 8)}`}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>

                    <button className="btn-join-meeting" onClick={handleJoin}>
                        <span className="mi mi-sm" style={{ verticalAlign: 'middle', marginRight: '6px' }}>login</span>
                        Join Meeting
                    </button>
                </div>
            </div>
        </div>
    );
}

