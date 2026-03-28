/**
 * Webinar mode — 1-to-many broadcasting with panelists and attendees.
 *
 * Features:
 * - Panelist view (video/audio enabled)
 * - Attendee view (view-only, can chat and ask questions)
 * - Panelist management (promote/demote)
 * - Live stream to RTMP/YouTube/Facebook
 * - Registration page
 * - Attendee count display
 * - Hand raise for speaking privileges
 * - Q&A integration
 * - Practice session before going live
 */
import React, { useState } from 'react';

interface Panelist {
    id: string;
    name: string;
    role: 'host' | 'panelist';
    videoEnabled: boolean;
    audioEnabled: boolean;
    isPresenting: boolean;
}

interface WebinarProps {
    meetingCode: string;
    hostName: string;
    webinarTitle: string;
    webinarDescription?: string;
    panelists: Panelist[];
    attendeeCount: number;
    isHost: boolean;
    isPanelist: boolean;
    isLive: boolean;
    isPractice: boolean;
    onGoLive: () => void;
    onEndWebinar: () => void;
    onPromoteToPanel: (userId: string) => void;
    onDemoteFromPanel: (userId: string) => void;
    onStartStream: (url: string) => void;
    onStopStream: () => void;
}

const Webinar: React.FC<WebinarProps> = ({
    meetingCode,
    webinarTitle,
    webinarDescription,
    panelists,
    attendeeCount,
    isHost,
    isLive,
    isPractice,
    onGoLive,
    onEndWebinar,
    onStartStream,
    onStopStream,
}) => {
    const [streamUrl, setStreamUrl] = useState('');
    const [showStreamSetup, setShowStreamSetup] = useState(false);

    return (
        <div style={{
            position: 'absolute',
            left: 0, right: 0, top: 0,
            height: '48px',
            background: isLive
                ? 'linear-gradient(90deg, rgba(239,68,68,0.15), rgba(239,68,68,0.05))'
                : 'linear-gradient(90deg, rgba(234,179,8,0.15), rgba(234,179,8,0.05))',
            borderBottom: `1px solid ${isLive ? 'rgba(239,68,68,0.2)' : 'rgba(234,179,8,0.2)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 20px',
            zIndex: 50,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {/* Live indicator */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '4px 10px', borderRadius: '6px',
                    background: isLive ? '#ef4444' : isPractice ? '#eab308' : 'rgba(255,255,255,0.1)',
                    color: '#fff', fontSize: '11px', fontWeight: 700,
                }}>
                    <span style={{
                        width: '8px', height: '8px', borderRadius: '50%',
                        background: isLive ? '#fff' : isPractice ? '#000' : '#666',
                        animation: isLive ? 'pulse 1s infinite' : 'none',
                    }} />
                    {isLive ? 'LIVE' : isPractice ? 'PRACTICE' : 'NOT STARTED'}
                </div>

                <span style={{ color: '#fff', fontWeight: 600, fontSize: '14px' }}>
                    📺 {webinarTitle || 'Webinar'}
                </span>

                <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px' }}>
                    {meetingCode}
                </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {/* Attendee count */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    color: 'rgba(255,255,255,0.6)', fontSize: '12px',
                }}>
                    <span>👥</span>
                    <span>{attendeeCount} attendees</span>
                    <span>•</span>
                    <span>{panelists.length} panelists</span>
                </div>

                {isHost && (
                    <>
                        {/* Live stream */}
                        <button onClick={() => setShowStreamSetup(!showStreamSetup)} style={{
                            padding: '5px 10px', borderRadius: '6px',
                            background: 'rgba(255,255,255,0.06)',
                            border: 'none', color: '#fff', cursor: 'pointer', fontSize: '11px',
                        }}>
                            📡 Stream
                        </button>

                        {!isLive ? (
                            <button onClick={onGoLive} style={{
                                padding: '5px 14px', borderRadius: '6px',
                                background: '#ef4444', border: 'none',
                                color: '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                            }}>
                                🔴 Go Live
                            </button>
                        ) : (
                            <button onClick={onEndWebinar} style={{
                                padding: '5px 14px', borderRadius: '6px',
                                background: 'rgba(239,68,68,0.2)',
                                border: '1px solid rgba(239,68,68,0.3)',
                                color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                            }}>
                                End Webinar
                            </button>
                        )}
                    </>
                )}
            </div>

            {/* Stream setup popover */}
            {showStreamSetup && (
                <div style={{
                    position: 'absolute', right: '16px', top: '52px',
                    width: '320px', padding: '16px', borderRadius: '12px',
                    background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)',
                    boxShadow: '0 10px 30px rgba(0,0,0,0.5)', zIndex: 60,
                }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff', marginBottom: '10px' }}>
                        📡 Live Stream Setup
                    </div>
                    <input
                        type="text" placeholder="rtmp://... or YouTube stream key"
                        value={streamUrl} onChange={e => setStreamUrl(e.target.value)}
                        style={{
                            width: '100%', background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
                            color: '#fff', padding: '8px 10px', fontSize: '12px',
                            marginBottom: '8px', boxSizing: 'border-box',
                        }}
                    />
                    <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={() => { onStartStream(streamUrl); setShowStreamSetup(false); }} style={{
                            flex: 1, padding: '8px', borderRadius: '8px',
                            background: '#22c55e', border: 'none', color: '#fff',
                            cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                        }}>
                            Start Stream
                        </button>
                        <button onClick={() => { onStopStream(); setShowStreamSetup(false); }} style={{
                            padding: '8px 12px', borderRadius: '8px',
                            background: 'rgba(239,68,68,0.15)', border: 'none',
                            color: '#ef4444', cursor: 'pointer', fontSize: '12px',
                        }}>
                            Stop
                        </button>
                    </div>
                    <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginTop: '8px' }}>
                        Supports YouTube, Facebook, Twitch, and custom RTMP
                    </div>
                </div>
            )}
        </div>
    );
};

export default Webinar;
