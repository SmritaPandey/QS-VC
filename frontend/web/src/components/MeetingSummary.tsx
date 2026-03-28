/**
 * MeetingSummary — AI-generated post-meeting summary.
 *
 * Features:
 * - Auto-generated summary from captions/transcript
 * - Action items extraction
 * - Key decisions
 * - Participant speaking time
 * - Sentiment analysis
 * - Export as PDF/Markdown
 * - Share via email
 */
import React, { useState } from 'react';

interface ActionItem {
    id: string;
    text: string;
    assignee?: string;
    dueDate?: string;
    completed: boolean;
    priority: 'high' | 'medium' | 'low';
}

interface KeyDecision {
    id: string;
    decision: string;
    context: string;
    timestamp: number;
}

interface ParticipantStats {
    name: string;
    speakingTimeMs: number;
    messageCount: number;
    reactionsCount: number;
    questionsAsked: number;
}

interface MeetingSummaryData {
    meetingCode: string;
    title: string;
    dateTime: string;
    duration: number;         // minutes
    participantCount: number;
    summary: string;
    actionItems: ActionItem[];
    keyDecisions: KeyDecision[];
    participantStats: ParticipantStats[];
    sentiment: 'positive' | 'neutral' | 'negative';
    topics: string[];
    transcript?: string;
}

interface MeetingSummaryProps {
    data: MeetingSummaryData;
    onExport: (format: 'pdf' | 'markdown') => void;
    onShare: (email: string) => void;
    onToggleActionItem: (id: string) => void;
}

const MeetingSummary: React.FC<MeetingSummaryProps> = ({
    data,
    onExport,
    onShare,
    onToggleActionItem,
}) => {
    const [shareEmail, setShareEmail] = useState('');
    const [showTranscript, setShowTranscript] = useState(false);

    const sentimentColors = {
        positive: { bg: 'rgba(34,197,94,0.1)', color: '#22c55e', icon: '😊' },
        neutral: { bg: 'rgba(234,179,8,0.1)', color: '#eab308', icon: '😐' },
        negative: { bg: 'rgba(239,68,68,0.1)', color: '#ef4444', icon: '😟' },
    };

    const sent = sentimentColors[data.sentiment];

    return (
        <div style={{
            maxWidth: '800px', margin: '0 auto', padding: '32px',
            color: '#fff', fontFamily: "'Inter', sans-serif",
        }}>
            {/* Header */}
            <div style={{
                padding: '24px', borderRadius: '16px',
                background: 'linear-gradient(135deg, #1a1a35, #0d0d1e)',
                border: '1px solid rgba(139,92,246,0.2)',
                marginBottom: '24px',
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                        <div style={{ fontSize: '11px', color: '#8b5cf6', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px' }}>
                            AI Meeting Summary
                        </div>
                        <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '8px 0 4px', color: '#fff' }}>
                            {data.title || `Meeting ${data.meetingCode}`}
                        </h1>
                        <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: 'rgba(255,255,255,0.5)' }}>
                            <span>📅 {data.dateTime}</span>
                            <span>⏱️ {data.duration} min</span>
                            <span>👥 {data.participantCount} participants</span>
                        </div>
                    </div>

                    {/* Sentiment badge */}
                    <div style={{
                        padding: '8px 14px', borderRadius: '10px',
                        background: sent.bg, border: `1px solid ${sent.color}33`,
                        display: 'flex', alignItems: 'center', gap: '6px',
                    }}>
                        <span style={{ fontSize: '18px' }}>{sent.icon}</span>
                        <span style={{ color: sent.color, fontSize: '12px', fontWeight: 600, textTransform: 'capitalize' }}>
                            {data.sentiment}
                        </span>
                    </div>
                </div>

                {/* Topics */}
                <div style={{ display: 'flex', gap: '6px', marginTop: '12px', flexWrap: 'wrap' }}>
                    {data.topics.map((topic, i) => (
                        <span key={i} style={{
                            padding: '3px 10px', borderRadius: '12px',
                            background: 'rgba(139,92,246,0.12)', color: '#a78bfa',
                            fontSize: '11px', fontWeight: 500,
                        }}>
                            {topic}
                        </span>
                    ))}
                </div>
            </div>

            {/* Summary */}
            <div style={{
                padding: '20px', borderRadius: '12px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                marginBottom: '16px',
            }}>
                <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px', color: '#8b5cf6' }}>
                    📝 Summary
                </h3>
                <p style={{ fontSize: '14px', lineHeight: 1.8, color: 'rgba(255,255,255,0.8)', margin: 0 }}>
                    {data.summary}
                </p>
            </div>

            {/* Action Items */}
            {data.actionItems.length > 0 && (
                <div style={{
                    padding: '20px', borderRadius: '12px',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    marginBottom: '16px',
                }}>
                    <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: '#eab308' }}>
                        ✅ Action Items ({data.actionItems.length})
                    </h3>
                    {data.actionItems.map(item => (
                        <div key={item.id} style={{
                            display: 'flex', alignItems: 'flex-start', gap: '10px',
                            padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)',
                        }}>
                            <button onClick={() => onToggleActionItem(item.id)} style={{
                                marginTop: '2px', width: '18px', height: '18px', borderRadius: '4px',
                                border: `1px solid ${item.completed ? '#22c55e' : 'rgba(255,255,255,0.2)'}`,
                                background: item.completed ? '#22c55e' : 'transparent',
                                cursor: 'pointer', flexShrink: 0,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: '#fff', fontSize: '10px',
                            }}>
                                {item.completed && '✓'}
                            </button>
                            <div style={{ flex: 1 }}>
                                <div style={{
                                    fontSize: '13px', color: item.completed ? 'rgba(255,255,255,0.4)' : '#fff',
                                    textDecoration: item.completed ? 'line-through' : 'none',
                                }}>
                                    {item.text}
                                </div>
                                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginTop: '2px' }}>
                                    {item.assignee && `→ ${item.assignee}`}
                                    {item.dueDate && ` • Due: ${item.dueDate}`}
                                </div>
                            </div>
                            <span style={{
                                padding: '2px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: 600,
                                background: item.priority === 'high' ? 'rgba(239,68,68,0.15)' : item.priority === 'medium' ? 'rgba(234,179,8,0.15)' : 'rgba(34,197,94,0.15)',
                                color: item.priority === 'high' ? '#ef4444' : item.priority === 'medium' ? '#eab308' : '#22c55e',
                            }}>
                                {item.priority}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {/* Participant Stats */}
            <div style={{
                padding: '20px', borderRadius: '12px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                marginBottom: '16px',
            }}>
                <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: '#3b82f6' }}>
                    📊 Participation
                </h3>
                {data.participantStats.map((p, i) => {
                    const maxTime = Math.max(...data.participantStats.map(s => s.speakingTimeMs), 1);
                    const pct = (p.speakingTimeMs / maxTime) * 100;
                    return (
                        <div key={i} style={{ marginBottom: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '3px' }}>
                                <span style={{ color: '#fff' }}>{p.name}</span>
                                <span style={{ color: 'rgba(255,255,255,0.4)' }}>
                                    {Math.round(p.speakingTimeMs / 60000)}m • {p.messageCount} msgs
                                </span>
                            </div>
                            <div style={{ height: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', overflow: 'hidden' }}>
                                <div style={{ width: `${pct}%`, height: '100%', background: '#3b82f6', borderRadius: '2px' }} />
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Export / Share */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button onClick={() => onExport('markdown')} style={{
                    padding: '10px 18px', borderRadius: '10px',
                    background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)',
                    color: '#a78bfa', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                }}>
                    📄 Export Markdown
                </button>
                <button onClick={() => onExport('pdf')} style={{
                    padding: '10px 18px', borderRadius: '10px',
                    background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
                    color: '#ef4444', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                }}>
                    📑 Export PDF
                </button>
                <div style={{ display: 'flex', gap: '4px' }}>
                    <input
                        type="email" placeholder="Share via email..."
                        value={shareEmail} onChange={e => setShareEmail(e.target.value)}
                        style={{
                            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '10px', color: '#fff', padding: '10px 14px', fontSize: '12px',
                        }}
                    />
                    <button onClick={() => { onShare(shareEmail); setShareEmail(''); }} style={{
                        padding: '10px 14px', borderRadius: '10px',
                        background: '#22c55e', border: 'none', color: '#fff',
                        cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                    }}>
                        Send
                    </button>
                </div>
            </div>

            {/* Transcript toggle */}
            {data.transcript && (
                <div style={{ marginTop: '16px' }}>
                    <button onClick={() => setShowTranscript(!showTranscript)} style={{
                        background: 'transparent', border: 'none', color: '#8b5cf6',
                        cursor: 'pointer', fontSize: '13px', padding: 0,
                    }}>
                        {showTranscript ? '▼' : '▶'} Full Transcript
                    </button>
                    {showTranscript && (
                        <pre style={{
                            marginTop: '8px', padding: '16px', borderRadius: '10px',
                            background: 'rgba(0,0,0,0.3)', color: 'rgba(255,255,255,0.6)',
                            fontSize: '12px', lineHeight: 1.6, overflow: 'auto', maxHeight: '400px',
                            whiteSpace: 'pre-wrap', fontFamily: 'monospace',
                        }}>
                            {data.transcript}
                        </pre>
                    )}
                </div>
            )}
        </div>
    );
};

export default MeetingSummary;
