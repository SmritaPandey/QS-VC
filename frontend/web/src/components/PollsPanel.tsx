/**
 * Polls + Q&A Panel for interactive meetings.
 *
 * Features:
 * - Create polls with multiple choice or rating
 * - Live vote tallying with bars
 * - Anonymous or named voting
 * - Q&A with upvoting
 * - Host can mark Q&A as answered
 * - Export results
 */
import React, { useState } from 'react';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TYPES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface PollOption {
    id: string;
    text: string;
    votes: number;
    voters: string[];
}

interface Poll {
    id: string;
    question: string;
    type: 'multiple-choice' | 'rating' | 'yes-no' | 'word-cloud';
    options: PollOption[];
    creatorId: string;
    isActive: boolean;
    isAnonymous: boolean;
    totalVotes: number;
    createdAt: number;
}

interface QnAQuestion {
    id: string;
    text: string;
    askedBy: string;
    askedByName: string;
    upvotes: number;
    upvoters: string[];
    isAnswered: boolean;
    answer?: string;
    timestamp: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POLLS COMPONENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface PollsPanelProps {
    isHost: boolean;
    userId: string;
    polls: Poll[];
    onCreatePoll: (poll: Omit<Poll, 'id' | 'totalVotes' | 'createdAt'>) => void;
    onVote: (pollId: string, optionId: string) => void;
    onClosePoll: (pollId: string) => void;
    questions: QnAQuestion[];
    onAskQuestion: (text: string) => void;
    onUpvoteQuestion: (questionId: string) => void;
    onMarkAnswered: (questionId: string, answer?: string) => void;
    isOpen: boolean;
    onClose: () => void;
}

const PollsPanel: React.FC<PollsPanelProps> = ({
    isHost,
    userId,
    polls,
    onCreatePoll,
    onVote,
    onClosePoll,
    questions,
    onAskQuestion,
    onUpvoteQuestion,
    onMarkAnswered,
    isOpen,
    onClose,
}) => {
    const [activeTab, setActiveTab] = useState<'polls' | 'qna'>('polls');
    const [showCreate, setShowCreate] = useState(false);
    const [newQuestion, setNewQuestion] = useState('');
    const [pollQuestion, setPollQuestion] = useState('');
    const [pollOptions, setPollOptions] = useState(['', '']);
    const [isAnonymous, setIsAnonymous] = useState(false);

    if (!isOpen) return null;

    function handleCreatePoll() {
        if (!pollQuestion.trim() || pollOptions.filter(o => o.trim()).length < 2) return;

        onCreatePoll({
            question: pollQuestion,
            type: 'multiple-choice',
            options: pollOptions.filter(o => o.trim()).map((text, i) => ({
                id: `opt-${i}`,
                text,
                votes: 0,
                voters: [],
            })),
            creatorId: userId,
            isActive: true,
            isAnonymous,
        });

        setPollQuestion('');
        setPollOptions(['', '']);
        setShowCreate(false);
    }

    const sortedQuestions = [...questions].sort((a, b) => b.upvotes - a.upvotes);

    return (
        <div style={{
            position: 'absolute',
            right: '16px',
            top: '60px',
            width: '370px',
            maxHeight: 'calc(100vh - 160px)',
            background: 'linear-gradient(135deg, #0d0d1e 0%, #1a1a35 100%)',
            borderRadius: '16px',
            border: '1px solid rgba(234,179,8,0.2)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            zIndex: 100,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
        }}>
            {/* Header */}
            <div style={{
                padding: '14px 16px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
                <div style={{ display: 'flex', gap: '0' }}>
                    {(['polls', 'qna'] as const).map(tab => (
                        <button key={tab} onClick={() => setActiveTab(tab)} style={{
                            padding: '6px 16px', border: 'none',
                            borderBottom: activeTab === tab ? '2px solid #eab308' : '2px solid transparent',
                            background: 'transparent',
                            color: activeTab === tab ? '#fff' : 'rgba(255,255,255,0.4)',
                            cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                        }}>
                            {tab === 'polls' ? '📊 Polls' : '❓ Q&A'}
                            {tab === 'qna' && questions.length > 0 && (
                                <span style={{
                                    marginLeft: '4px', padding: '1px 6px', borderRadius: '10px',
                                    background: '#eab308', color: '#000', fontSize: '10px',
                                }}>
                                    {questions.filter(q => !q.isAnswered).length}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
                <button onClick={onClose} style={{
                    background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '8px',
                    color: '#fff', padding: '6px 8px', cursor: 'pointer',
                }}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
                {activeTab === 'polls' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {/* Create poll button */}
                        {isHost && !showCreate && (
                            <button onClick={() => setShowCreate(true)} style={{
                                padding: '10px', borderRadius: '10px',
                                background: 'rgba(234,179,8,0.1)',
                                border: '1px dashed rgba(234,179,8,0.3)',
                                color: '#eab308', cursor: 'pointer', fontSize: '13px',
                            }}>
                                + Create Poll
                            </button>
                        )}

                        {/* Create poll form */}
                        {showCreate && (
                            <div style={{
                                padding: '12px', borderRadius: '10px',
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid rgba(255,255,255,0.08)',
                                display: 'flex', flexDirection: 'column', gap: '8px',
                            }}>
                                <input
                                    type="text" placeholder="Poll question..."
                                    value={pollQuestion} onChange={e => setPollQuestion(e.target.value)}
                                    style={{
                                        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                                        borderRadius: '8px', color: '#fff', padding: '8px 10px', fontSize: '13px',
                                    }}
                                />
                                {pollOptions.map((opt, i) => (
                                    <input key={i} type="text" placeholder={`Option ${i + 1}`}
                                        value={opt} onChange={e => {
                                            const newOpts = [...pollOptions];
                                            newOpts[i] = e.target.value;
                                            setPollOptions(newOpts);
                                        }}
                                        style={{
                                            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                                            borderRadius: '6px', color: '#fff', padding: '6px 10px', fontSize: '12px',
                                        }}
                                    />
                                ))}
                                <button onClick={() => setPollOptions([...pollOptions, ''])} style={{
                                    background: 'transparent', border: 'none', color: '#eab308',
                                    cursor: 'pointer', fontSize: '12px', textAlign: 'left', padding: '4px 0',
                                }}>
                                    + Add option
                                </button>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#aaa', fontSize: '12px' }}>
                                    <input type="checkbox" checked={isAnonymous} onChange={e => setIsAnonymous(e.target.checked)} />
                                    Anonymous voting
                                </label>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                    <button onClick={handleCreatePoll} style={{
                                        flex: 1, padding: '8px', borderRadius: '8px',
                                        background: '#eab308', border: 'none', color: '#000',
                                        cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                                    }}>
                                        Launch Poll
                                    </button>
                                    <button onClick={() => setShowCreate(false)} style={{
                                        padding: '8px 12px', borderRadius: '8px',
                                        background: 'rgba(255,255,255,0.06)', border: 'none',
                                        color: '#fff', cursor: 'pointer', fontSize: '12px',
                                    }}>
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Active polls */}
                        {polls.map(poll => (
                            <div key={poll.id} style={{
                                padding: '12px', borderRadius: '10px',
                                background: 'rgba(255,255,255,0.03)',
                                border: `1px solid ${poll.isActive ? 'rgba(234,179,8,0.2)' : 'rgba(255,255,255,0.06)'}`,
                            }}>
                                <div style={{ fontWeight: 600, color: '#fff', fontSize: '13px', marginBottom: '8px' }}>
                                    {poll.question}
                                    {!poll.isActive && <span style={{ color: '#ef4444', marginLeft: '6px', fontSize: '10px' }}>CLOSED</span>}
                                </div>

                                {poll.options.map(opt => {
                                    const pct = poll.totalVotes > 0 ? (opt.votes / poll.totalVotes) * 100 : 0;
                                    const hasVoted = opt.voters.includes(userId);

                                    return (
                                        <div key={opt.id} style={{ marginBottom: '6px' }}>
                                            <button
                                                onClick={() => poll.isActive && onVote(poll.id, opt.id)}
                                                disabled={!poll.isActive}
                                                style={{
                                                    width: '100%', textAlign: 'left',
                                                    padding: '6px 10px', borderRadius: '6px',
                                                    border: hasVoted ? '1px solid #eab308' : '1px solid rgba(255,255,255,0.08)',
                                                    background: 'rgba(255,255,255,0.02)',
                                                    color: '#fff', cursor: poll.isActive ? 'pointer' : 'default',
                                                    fontSize: '12px', position: 'relative', overflow: 'hidden',
                                                }}
                                            >
                                                <div style={{
                                                    position: 'absolute', left: 0, top: 0, bottom: 0,
                                                    width: `${pct}%`,
                                                    background: hasVoted ? 'rgba(234,179,8,0.15)' : 'rgba(255,255,255,0.04)',
                                                    transition: 'width 0.5s ease',
                                                }} />
                                                <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between' }}>
                                                    <span>{hasVoted && '✓ '}{opt.text}</span>
                                                    <span style={{ color: '#eab308', fontWeight: 600 }}>{Math.round(pct)}%</span>
                                                </div>
                                            </button>
                                        </div>
                                    );
                                })}

                                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginTop: '4px', display: 'flex', justifyContent: 'space-between' }}>
                                    <span>{poll.totalVotes} votes</span>
                                    {isHost && poll.isActive && (
                                        <button onClick={() => onClosePoll(poll.id)} style={{
                                            background: 'transparent', border: 'none', color: '#ef4444',
                                            cursor: 'pointer', fontSize: '10px',
                                        }}>
                                            Close poll
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}

                        {polls.length === 0 && !showCreate && (
                            <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(255,255,255,0.3)' }}>
                                <div style={{ fontSize: '32px', marginBottom: '8px' }}>📊</div>
                                <div style={{ fontSize: '13px' }}>No polls yet</div>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'qna' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {/* Ask question */}
                        <div style={{ display: 'flex', gap: '6px' }}>
                            <input
                                type="text" placeholder="Ask a question..."
                                value={newQuestion} onChange={e => setNewQuestion(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && newQuestion.trim()) { onAskQuestion(newQuestion); setNewQuestion(''); } }}
                                style={{
                                    flex: 1, background: 'rgba(255,255,255,0.06)',
                                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
                                    color: '#fff', padding: '8px 10px', fontSize: '12px',
                                }}
                            />
                            <button onClick={() => { if (newQuestion.trim()) { onAskQuestion(newQuestion); setNewQuestion(''); } }} style={{
                                background: '#eab308', border: 'none', borderRadius: '8px',
                                color: '#000', padding: '8px 12px', cursor: 'pointer', fontWeight: 600, fontSize: '12px',
                            }}>
                                Ask
                            </button>
                        </div>

                        {/* Questions list */}
                        {sortedQuestions.map(q => (
                            <div key={q.id} style={{
                                padding: '10px', borderRadius: '10px',
                                background: q.isAnswered ? 'rgba(34,197,94,0.05)' : 'rgba(255,255,255,0.03)',
                                border: `1px solid ${q.isAnswered ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.06)'}`,
                                display: 'flex', gap: '10px',
                            }}>
                                {/* Upvote */}
                                <button onClick={() => onUpvoteQuestion(q.id)} style={{
                                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                                    background: q.upvoters.includes(userId) ? 'rgba(234,179,8,0.15)' : 'transparent',
                                    border: 'none', color: q.upvoters.includes(userId) ? '#eab308' : 'rgba(255,255,255,0.4)',
                                    cursor: 'pointer', padding: '4px 6px', borderRadius: '6px',
                                    minWidth: '36px',
                                }}>
                                    <span style={{ fontSize: '14px' }}>▲</span>
                                    <span style={{ fontSize: '12px', fontWeight: 700 }}>{q.upvotes}</span>
                                </button>

                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: '13px', color: '#fff', marginBottom: '4px' }}>
                                        {q.text}
                                    </div>
                                    <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>
                                        {q.askedByName} • {new Date(q.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        {q.isAnswered && <span style={{ color: '#22c55e', marginLeft: '6px' }}>✓ Answered</span>}
                                    </div>
                                    {q.isAnswered && q.answer && (
                                        <div style={{ marginTop: '6px', padding: '6px 8px', borderRadius: '6px', background: 'rgba(34,197,94,0.08)', fontSize: '12px', color: '#22c55e' }}>
                                            {q.answer}
                                        </div>
                                    )}
                                    {isHost && !q.isAnswered && (
                                        <button onClick={() => onMarkAnswered(q.id)} style={{
                                            marginTop: '4px', background: 'transparent', border: 'none',
                                            color: '#22c55e', cursor: 'pointer', fontSize: '10px',
                                        }}>
                                            Mark as answered
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}

                        {questions.length === 0 && (
                            <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(255,255,255,0.3)' }}>
                                <div style={{ fontSize: '32px', marginBottom: '8px' }}>❓</div>
                                <div style={{ fontSize: '13px' }}>No questions yet</div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default PollsPanel;
