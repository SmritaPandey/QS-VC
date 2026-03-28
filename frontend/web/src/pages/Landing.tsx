import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const SIGNALING_API = import.meta.env.VITE_API_URL || '';

export default function Landing() {
    const [joinCode, setJoinCode] = useState('');
    const [creating, setCreating] = useState(false);
    const [shareLink, setShareLink] = useState('');
    const [shareMeetingCode, setShareMeetingCode] = useState('');
    const [copied, setCopied] = useState(false);
    const navigate = useNavigate();

    const handleCreate = async () => {
        setCreating(true);
        try {
            const res = await fetch(`${SIGNALING_API}/api/meetings/create`, { method: 'POST' });
            const data = await res.json();
            const fullLink = `${window.location.origin}/meeting/${data.meetingCode}/preview`;
            setShareMeetingCode(data.meetingCode);
            setShareLink(fullLink);
        } catch (err) {
            console.error('Failed to create meeting:', err);
            alert('Failed to create meeting. Is the signaling server running?');
        } finally {
            setCreating(false);
        }
    };

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(shareLink);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Fallback for non-HTTPS contexts
            const ta = document.createElement('textarea');
            ta.value = shareLink;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleGoToMeeting = () => {
        navigate(`/meeting/${shareMeetingCode}/preview`);
    };

    const handleJoin = () => {
        const code = joinCode.trim().toUpperCase();
        if (!code) return;
        navigate(`/meeting/${code}/preview`);
    };

    return (
        <div className="landing-page">
            <div className="landing-bg-gradient" />

            <nav className="landing-nav">
                <div className="landing-nav-logo">
                    <span className="mi" style={{ color: 'var(--accent-secondary)' }}>verified_user</span>
                    <span className="landing-nav-brand">QS-VC</span>
                </div>
                <div className="landing-nav-links">
                    <button className="btn-outline" onClick={() => navigate('/schedule')}>
                        <span className="mi mi-sm">calendar_today</span>
                        Schedule
                    </button>
                    <button className="btn-outline" onClick={() => navigate('/admin')}>
                        <span className="mi mi-sm">admin_panel_settings</span>
                        Admin
                    </button>
                </div>
            </nav>

            <div className="landing-container">
                <div className="landing-hero">
                    <div className="logo-badge">
                        <span className="mi logo-icon">shield</span>
                        <span className="logo-text">QS-VC</span>
                    </div>
                    <h1>Quantum Safe<br />Video Conferencing</h1>
                    <p className="landing-subtitle">
                        India's quantum-safe video conferencing — unbreakable meetings with
                        AI captions, noise suppression, and post-quantum encryption.
                    </p>
                </div>

                <div className="landing-actions">
                    <div className="action-card">
                        <h2>New Meeting</h2>
                        <p>Create an instant meeting and invite others</p>
                        <button
                            className="btn-primary"
                            onClick={handleCreate}
                            disabled={creating}
                        >
                            {creating ? (
                                <span className="spinner" />
                            ) : (
                                <>
                                    <span className="mi mi-sm">videocam</span>
                                    Create Meeting
                                </>
                            )}
                        </button>
                        <button
                            className="btn-outline"
                            onClick={() => navigate('/schedule')}
                            style={{ marginTop: '10px', width: '100%' }}
                        >
                            <span className="mi mi-sm">calendar_today</span>
                            Schedule for Later
                        </button>
                    </div>

                    <div className="action-divider">
                        <span>OR</span>
                    </div>

                    <div className="action-card">
                        <h2>Join Meeting</h2>
                        <p>Enter a meeting code to join</p>
                        <div className="join-input-group">
                            <input
                                type="text"
                                placeholder="QS-XXXX-XXXX-XXXX"
                                value={joinCode}
                                onChange={(e) => setJoinCode(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                                className="input-meeting-code"
                            />
                            <button
                                className="btn-primary"
                                onClick={handleJoin}
                                disabled={!joinCode.trim()}
                                style={{ padding: '12px 24px' }}
                            >
                                <span className="mi mi-sm">login</span>
                                Join
                            </button>
                        </div>
                    </div>
                </div>

                <div className="landing-features">
                    <div className="feature-chip"><span className="mi mi-sm">lock</span> Post-Quantum Encryption</div>
                    <div className="feature-chip"><span className="mi mi-sm">smart_toy</span> AI Captions & Translation</div>
                    <div className="feature-chip"><span className="mi mi-sm">mic_off</span> Noise Suppression</div>
                    <div className="feature-chip"><span className="mi mi-sm">flag</span> Made in India 🇮🇳</div>
                </div>
            </div>

            {/* ── Share Link Modal ── */}
            {shareLink && (
                <div className="share-modal-overlay" onClick={() => setShareLink('')}>
                    <div className="share-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="share-modal-icon">
                            <span className="mi" style={{ fontSize: 48, color: 'var(--accent-success)' }}>check_circle</span>
                        </div>
                        <h2>Meeting Created!</h2>
                        <p className="share-modal-code">
                            <span className="mi mi-sm">lock</span> {shareMeetingCode}
                        </p>
                        <p style={{ color: 'var(--text-secondary)', margin: '8px 0 16px' }}>
                            Share this link with participants:
                        </p>
                        <div className="share-link-box">
                            <input
                                type="text"
                                value={shareLink}
                                readOnly
                                className="share-link-input"
                                onClick={(e) => (e.target as HTMLInputElement).select()}
                            />
                            <button className="btn-copy" onClick={handleCopy}>
                                <span className="mi mi-sm">{copied ? 'done' : 'content_copy'}</span>
                                {copied ? 'Copied!' : 'Copy'}
                            </button>
                        </div>
                        <div className="share-modal-actions">
                            <button className="btn-primary btn-lg" onClick={handleGoToMeeting}>
                                <span className="mi mi-sm">videocam</span>
                                Join Meeting Now
                            </button>
                            <button className="btn-outline" onClick={() => setShareLink('')}>
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

