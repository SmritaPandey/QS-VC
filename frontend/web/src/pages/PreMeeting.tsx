import ThemeSelect from '../components/ThemeSelect';
import ActionContents from '../components/ActionContents';
import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { haptic } from '../lib/haptics';
import { AUTH_API, getToken } from '../lib/session';
import { CameraCapture, watchCameraVisibility, watchCameraTrack, cameraAccessMessage } from '../lib/camera-capture';

export default function PreMeeting() {
    const { meetingCode } = useParams<{ meetingCode: string }>();
    const navigate = useNavigate();
    const videoRef = useRef<HTMLVideoElement>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [displayName, setDisplayName] = useState('');
    // Signed-in people join under their account name instead of "Guest" (still editable).
    useEffect(() => {
        const token = getToken();
        if (!token) return;
        const controller = new AbortController();
        fetch(`${AUTH_API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
            .then(response => response.ok ? response.json() : null)
            .then(profile => {
                const name = typeof profile?.displayName === 'string' ? profile.displayName.trim().slice(0, 100) : '';
                if (name) setDisplayName(current => current || name);
            }).catch(() => { /* Name stays editable; joining still works. */ });
        return () => controller.abort();
    }, []);
    const [audioMuted, setAudioMuted] = useState(false);
    const [videoOff, setVideoOff] = useState(document.hidden);
    const [cameraNotice, setCameraNotice] = useState('');
    const [cameraPending, setCameraPending] = useState(!document.hidden);
    const [copied, setCopied] = useState(false);
    const [shareOpen, setShareOpen] = useState(false);
    const [micId, setMicId] = useState('');
    const [cameraId, setCameraId] = useState('');
    const streamRef = useRef<MediaStream | null>(null);
    // Mirrors of the toggles so a re-opened preview starts in the chosen state.
    const audioMutedRef = useRef(false);
    const videoOffRef = useRef(document.hidden);
    const cameraCapture = useRef(new CameraCapture());
    const captureEpoch = useRef(0);
    const audioRequest = useRef(0);
    const [devices, setDevices] = useState<{
        cameras: MediaDeviceInfo[];
        mics: MediaDeviceInfo[];
        speakers: MediaDeviceInfo[];
    }>({ cameras: [], mics: [], speakers: [] });

    const inviteLink = `${window.location.origin}/meeting/${meetingCode}/preview`;

    const refreshDevices = () => navigator.mediaDevices.enumerateDevices().then((devs) => {
        setDevices({
            cameras: devs.filter((d) => d.kind === 'videoinput'),
            mics: devs.filter((d) => d.kind === 'audioinput'),
            speakers: devs.filter((d) => d.kind === 'audiooutput'),
        });
    }).catch(() => { });

    // Microphone changes do not reopen a camera that the user has turned off.
    useEffect(() => {
        let cancelled = false;
        if (!navigator.mediaDevices?.getUserMedia) { audioMutedRef.current = true; setAudioMuted(true); return; }
        const epoch = captureEpoch.current;
        const request = ++audioRequest.current;
        streamRef.current?.getAudioTracks().forEach(t => t.stop());
        const audio = micId ? { deviceId: { exact: micId } } : true;
        navigator.mediaDevices.getUserMedia({ audio, video: false }).then(s => {
            if (cancelled || request !== audioRequest.current || epoch !== captureEpoch.current) { s.getTracks().forEach(t => t.stop()); return; }
            const current = streamRef.current ?? new MediaStream();
            current.getAudioTracks().forEach(t => { t.stop(); current.removeTrack(t); });
            s.getAudioTracks().forEach(t => {
                t.enabled = !audioMutedRef.current;
                t.onended = () => { audioMutedRef.current = true; setAudioMuted(true); };
                current.addTrack(t);
            });
            streamRef.current = current;
            setStream(new MediaStream(current.getTracks()));
            refreshDevices();
        }).catch(() => { if (!cancelled) { audioMutedRef.current = true; setAudioMuted(true); refreshDevices(); } });
        return () => { cancelled = true; };
    }, [micId]);

    useEffect(() => {
        let cancelled = false;
        if (!navigator.mediaDevices?.getUserMedia) { videoOffRef.current = true; setVideoOff(true); setCameraPending(false); setCameraNotice('Camera access is not supported in this browser.'); return; }
        if (videoOff) { cameraCapture.current.stop(); setCameraPending(false); return; }
        setCameraPending(true);
        const video = { width: 1280, height: 720, ...(cameraId ? { deviceId: { exact: cameraId } } : {}) };
        cameraCapture.current.start(video).then(track => {
            if (!track || cancelled) {
                track?.stop();
                if (!cancelled) { videoOffRef.current = true; setVideoOff(true); setCameraPending(false); }
                return;
            }
            const current = streamRef.current ?? new MediaStream();
            current.getVideoTracks().forEach(t => current.removeTrack(t));
            current.addTrack(track);
            const unavailable = () => {
                if (!streamRef.current?.getVideoTracks().includes(track)) return;
                cameraCapture.current.stop();
                videoOffRef.current = true;
                setVideoOff(true);
                setCameraNotice('Camera stopped by your browser or device. Start it when you are ready.');
            };
            watchCameraTrack(track, unavailable, interrupted => {
                if (!streamRef.current?.getVideoTracks().includes(track)) return;
                setCameraNotice(current => interrupted ? 'Camera temporarily interrupted. Waiting for your browser.' : current.startsWith('Camera temporarily interrupted.') ? '' : current);
            });
            streamRef.current = current;
            setStream(new MediaStream(current.getTracks()));
            setCameraNotice(track.muted ? 'Camera temporarily interrupted. Waiting for your browser.' : '');
            setCameraPending(false);
            refreshDevices();
        }).catch(error => {
            if (!cancelled) { console.warn('[Preview] Camera access failed:', error); setCameraPending(false); videoOffRef.current = true; setVideoOff(true); setCameraNotice(cameraAccessMessage(error)); refreshDevices(); }
        });
        return () => { cancelled = true; cameraCapture.current.stop(); };
    }, [cameraId, videoOff]);

    useEffect(() => {
        const stopCamera = () => {
            cameraCapture.current.stop();
            videoOffRef.current = true;
            setVideoOff(true);
            setCameraNotice('Camera off while you were away. Start it when you are ready.');
        };
        const stopWatchingVisibility = watchCameraVisibility(stopCamera);
        const onPageHide = () => {
            captureEpoch.current++;
            stopCamera();
            streamRef.current?.getTracks().forEach(t => t.stop());
            audioMutedRef.current = true;
            setAudioMuted(true);
        };
        window.addEventListener('pagehide', onPageHide);
        navigator.mediaDevices?.addEventListener('devicechange', refreshDevices);
        return () => {
            stopWatchingVisibility();
            window.removeEventListener('pagehide', onPageHide);
            navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices);
            captureEpoch.current++;
            cameraCapture.current.stop();
            streamRef.current?.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);

    // The choice is kept even if no device is available yet; it is what the meeting starts with.
    const toggleAudio = async () => {
        const muted = !audioMuted;
        haptic(muted ? 'toggleOff' : 'toggleOn');
        const current = streamRef.current ?? new MediaStream();
        if (!muted && !current.getAudioTracks().some(t => t.readyState === 'live')) {
            const epoch = captureEpoch.current;
            const request = ++audioRequest.current;
            try {
                const acquired = await navigator.mediaDevices.getUserMedia({ audio: micId ? { deviceId: { exact: micId } } : true, video: false });
                if (request !== audioRequest.current || epoch !== captureEpoch.current) { acquired.getTracks().forEach(t => t.stop()); return; }
                const latest = streamRef.current ?? current;
                latest.getAudioTracks().forEach(t => { t.stop(); latest.removeTrack(t); });
                acquired.getAudioTracks().forEach(t => { latest.addTrack(t); t.onended = () => { audioMutedRef.current = true; setAudioMuted(true); }; });
                streamRef.current = latest;
                setStream(new MediaStream(latest.getTracks()));
            } catch { return; }
        }
        audioMutedRef.current = muted;
        streamRef.current?.getAudioTracks().forEach(t => { t.enabled = !muted; });
        setAudioMuted(muted);
    };

    const toggleVideo = () => {
        const off = !videoOff;
        haptic(off ? 'toggleOff' : 'toggleOn');
        videoOffRef.current = off;
        if (off) cameraCapture.current.stop();
        setVideoOff(off);
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
            state: { displayName: name, audioMuted, videoOff, micId: micId || stream?.getAudioTracks()[0]?.getSettings().deviceId, cameraId: cameraId || stream?.getVideoTracks()[0]?.getSettings().deviceId },
        });
    };

    return (
        <div className="pre-meeting-page">
            <div className="preview-appearance"><ThemeSelect /></div>
            <button type="button" className="preview-back" onClick={() => navigate('/app', { replace: true })}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 5-7 7 7 7M5 12h14" /></svg>
                Back to meetings
            </button>
            <div className="pre-meeting-container">
                <div className="preview-section">
                    <div className="video-preview-wrapper">
                        <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            className={`video-preview ${videoOff || cameraPending ? 'video-off' : ''}`}
                        />
                        {(videoOff || cameraPending) && (
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
                                aria-pressed={!audioMuted}
                                aria-label="Microphone"
                                title={audioMuted ? 'Unmute' : 'Mute'}
                            >
                                <span className="mi">{audioMuted ? 'mic_off' : 'mic'}</span>
                            </button>
                            <button
                                className={`preview-btn ${videoOff ? 'muted' : ''}`}
                                onClick={toggleVideo}
                                aria-pressed={!videoOff && !cameraPending}
                                aria-busy={cameraPending}
                                aria-label="Camera"
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

                    <h2>Before you join.</h2>
                    {cameraNotice && <p role="status">{cameraNotice}</p>}

                    <div className="preview-invite-actions">
                    <button
                        className="btn-copy-invite qsvc-action qsvc-action--secondary"
                        onClick={handleCopyLink}
                        title="Copy meeting link to share with others"
                    ><ActionContents><span className="mi mi-sm" aria-hidden="true">{copied ? 'done' : 'link'}</span>
                        {copied ? 'Link copied' : 'Copy invitation link'}</ActionContents></button>
                    <button type="button" className="preview-share" aria-label="Share meeting invitation" title="Share invitation" aria-expanded={shareOpen} onClick={async () => {
                        if (navigator.share) {
                            try { await navigator.share({ title: 'Join my QS-VC meeting', text: 'Join me on QS-VC', url: inviteLink }); }
                            catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setShareOpen(true); }
                        } else setShareOpen(value => !value);
                    }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m9 10 6-4M9 14l6 4"/></svg></button>
                    </div>
                    {shareOpen && <div className="preview-share-options" aria-label="Share invitation options" onKeyDown={event => { if (event.key === 'Escape') { setShareOpen(false); document.querySelector<HTMLButtonElement>('.preview-share')?.focus(); } }}>
                        <a href={`https://wa.me/?text=${encodeURIComponent(`Join my QS-VC meeting: ${inviteLink}`)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
                        <a href={`mailto:?subject=${encodeURIComponent('Join my QS-VC meeting')}&body=${encodeURIComponent(inviteLink)}`}>Email</a>
                        <button type="button" onClick={() => setShareOpen(false)}>Close</button>
                    </div>}

                    <label className="field-label" htmlFor="display-name">Your name</label>
                    <input
                        id="display-name"
                        type="text"
                        aria-label="Your display name" placeholder="Enter your name"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="input-name"
                        onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                        autoFocus
                    />

                    <div className="device-selectors">
                        <label>
                            <span className="mi mi-sm" aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: '4px' }}>videocam</span>
                            Camera
                            <select className="device-select" value={cameraId || stream?.getVideoTracks()[0]?.getSettings().deviceId || ''} onChange={(e) => setCameraId(e.target.value)}>
                                {devices.cameras.map((d) => (
                                    <option key={d.deviceId} value={d.deviceId}>
                                        {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            <span className="mi mi-sm" aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: '4px' }}>mic</span>
                            Microphone
                            <select className="device-select" value={micId || stream?.getAudioTracks()[0]?.getSettings().deviceId || ''} onChange={(e) => setMicId(e.target.value)}>
                                {devices.mics.map((d) => (
                                    <option key={d.deviceId} value={d.deviceId}>
                                        {d.label || `Mic ${d.deviceId.slice(0, 8)}`}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>

                    <button className="btn-join-meeting qsvc-action" onClick={handleJoin}><ActionContents><span className="mi mi-sm" aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: '6px' }}>login</span>
                        Join meeting</ActionContents></button>
                </div>
            </div>
        </div>
    );
}

