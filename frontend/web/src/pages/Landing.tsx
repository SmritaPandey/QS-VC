import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const SIGNALING_API = 'http://localhost:4001';

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

            <div className="landing-container">
                <div className="landing-hero">
                    <div className="logo-badge">
                        <span className="logo-icon">🛡️</span>
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
                                    <span className="btn-icon">📹</span>
                                    Create Meeting
                                </>
                            )}
                        </button>
                        <button
                            className="btn-outline"
                            onClick={() => navigate('/schedule')}
                            style={{ marginTop: '8px' }}
                        >
                            <span className="btn-icon">📅</span>
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
                                className="btn-secondary"
                                onClick={handleJoin}
                                disabled={!joinCode.trim()}
                            >
                                Join
                            </button>
                        </div>
                    </div>
                </div>

                <div className="landing-features">
                    <div className="feature-chip">🔐 Post-Quantum Encryption</div>
                    <div className="feature-chip">🤖 AI Captions & Translation</div>
                    <div className="feature-chip">🎙️ Noise Suppression</div>
                    <div className="feature-chip">🌐 22 Indian Languages</div>
                </div>
            </div>
        </div>
    );
}
