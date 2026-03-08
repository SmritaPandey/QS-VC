import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const SIGNALING_API = import.meta.env.VITE_API_URL || '';

export default function Landing() {
    const [joinCode, setJoinCode] = useState('');
    const [creating, setCreating] = useState(false);
    const navigate = useNavigate();

    const handleCreate = async () => {
        setCreating(true);
        try {
            const res = await fetch(`${SIGNALING_API}/api/meetings/create`, { method: 'POST' });
            const data = await res.json();
            navigate(`/meeting/${data.meetingCode}/preview`);
        } catch (err) {
            console.error('Failed to create meeting:', err);
            alert('Failed to create meeting. Is the signaling server running?');
        } finally {
            setCreating(false);
        }
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
                    <h1>Quantum-Safe<br />Video Conference</h1>
                    <p className="landing-subtitle">
                        Next-generation secure meetings with AI-powered captions,
                        noise suppression, and post-quantum encryption.
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
                    <div className="feature-chip"><span className="mi mi-sm">language</span> 22 Indian Languages</div>
                </div>
            </div>
        </div>
    );
}
