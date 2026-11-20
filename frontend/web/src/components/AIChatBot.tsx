import { useState, useRef, useEffect } from 'react';
import { signaling } from '../lib/signaling';
import { createPortal } from 'react-dom';
import '../styles/ai-assistant.css';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
}

interface AIChatBotProps {
    onOpen?: () => void;
    closeSignal?: boolean;
    isHost?: boolean;
    e2eeActive?: boolean;
    participantsCount?: number;
    webinar?: boolean;
}

const QUICK_SUGGESTIONS = [
    'How do I share my screen?',
    'Verify post-quantum encryption',
    'How to record this meeting?',
    'Troubleshoot microphone / camera',
];

export default function AIChatBot({
    onOpen,
    closeSignal = false,
    isHost = false,
    e2eeActive = false,
    participantsCount = 1,
    webinar = false,
}: AIChatBotProps) {
    const [open, setOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([
        {
            id: '0',
            role: 'assistant',
            content: `Need a hand with the meeting? Ask about controls, post-quantum encryption, or audio/video settings. I do not read your conversation.`,
        },
    ]);
    const [input, setInput] = useState('');
    const pending = useRef(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const restoreFocus = useRef(false);

    const close = () => {
        restoreFocus.current = true;
        setOpen(false);
    };

    useEffect(() => {
        if (closeSignal) setOpen(false);
    }, [closeSignal]);

    useEffect(() => {
        if (open) inputRef.current?.focus();
        else if (restoreFocus.current) {
            triggerRef.current?.focus();
            restoreFocus.current = false;
        }
    }, [open]);

    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSend = async (queryText?: string) => {
        const text = (queryText || input).trim();
        if (!text || pending.current) return;
        pending.current = true;
        setSending(true);
        setError('');
        try {
            const { answer } = await signaling.request('askMeetingAssistant', {
                question: text,
                context: {
                    isHost,
                    e2eeActive,
                    participantsCount,
                    webinar,
                },
            });
            const id = crypto.randomUUID();
            setMessages(previous => [
                ...previous,
                { id: 'u-' + id, role: 'user', content: text },
                { id: 'a-' + id, role: 'assistant', content: answer },
            ]);
            if (!queryText) setInput('');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Could not get a response. Try again.');
        } finally {
            pending.current = false;
            setSending(false);
        }
    };

    const panelHost = triggerRef.current?.closest('.meeting-room');

    return (
        <>
            <button
                type="button"
                ref={triggerRef}
                className="ai-fab qsvc-assistant-launcher"
                aria-label={open ? 'Close meeting assistant' : 'Open meeting assistant'}
                aria-expanded={open}
                aria-controls={open ? 'meeting-assistant-panel' : undefined}
                onClick={() => {
                    if (open) close();
                    else {
                        onOpen?.();
                        setOpen(true);
                    }
                }}
                title="Meeting assistant"
            >
                <svg className="qsvc-assistant-symbol" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
                    <path
                        d="M39 33 C41 30 42 27 42 23 C42 13 34 5 24 5 C14 5 6 13 6 23 C6 33 14 41 24 41 C27 41 30 40 33 39 L42 43 Z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinejoin="round"
                    />
                    <g className="qsvc-assistant-eyes" fill="currentColor">
                        <path d="M15 17 L22 23 L15 29 Z" />
                        <path d="M33 17 L26 23 L33 29 Z" />
                    </g>
                </svg>
            </button>
            {open &&
                panelHost &&
                createPortal(
                    <div
                        id="meeting-assistant-panel"
                        className="ai-chat-panel"
                        role="complementary"
                        aria-label="Meeting assistant"
                        onKeyDown={event => {
                            if (event.key === 'Escape') close();
                        }}
                    >
                        <div className="ai-chat-header">
                            <div className="ai-chat-header-left">
                                <div className="ai-avatar">
                                    <span className="mi">forum</span>
                                </div>
                                <div>
                                    <div className="ai-chat-title">Meeting assistant</div>
                                    <div className="ai-chat-subtitle">
                                        Protected via Post-Quantum TLS 1.3 · Zero Data Retention
                                    </div>
                                </div>
                            </div>
                            <button className="panel-close" aria-label="Close meeting assistant" onClick={close}>
                                <span className="mi mi-sm">close</span>
                            </button>
                        </div>

                        <div className="ai-messages" ref={scrollRef} role="log" aria-live="polite">
                            {messages.map(msg => (
                                <div key={msg.id} className={`ai-msg ${msg.role}`}>
                                    <div className="ai-msg-bubble" style={{ whiteSpace: 'pre-line' }}>
                                        {msg.content}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="ai-quick-suggestions" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px 12px' }}>
                            {QUICK_SUGGESTIONS.map(suggestion => (
                                <button
                                    key={suggestion}
                                    type="button"
                                    disabled={sending}
                                    style={{
                                        fontSize: '0.75rem',
                                        padding: '4px 8px',
                                        borderRadius: '12px',
                                        background: 'rgba(255, 255, 255, 0.08)',
                                        border: '1px solid rgba(255, 255, 255, 0.15)',
                                        color: '#cbd5e1',
                                        cursor: 'pointer',
                                    }}
                                    onClick={() => handleSend(suggestion)}
                                >
                                    {suggestion}
                                </button>
                            ))}
                        </div>

                        {(sending || error) && (
                            <p role="status" style={{ padding: '0 12px', fontSize: '0.8rem', color: error ? '#f87171' : '#94a3b8' }}>
                                {sending ? 'Waiting for quantum-safe AI reply…' : error}
                            </p>
                        )}
                        <div className="ai-chat-input-area">
                            <input
                                ref={inputRef}
                                type="text"
                                className="ai-chat-input"
                                maxLength={2000}
                                aria-label="Message to meeting assistant"
                                placeholder="Ask a question…"
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') handleSend();
                                }}
                            />
                            <button
                                disabled={sending || !input.trim()}
                                className="ai-send-btn"
                                aria-label="Send to meeting assistant"
                                onClick={() => handleSend()}
                            >
                                <span className="mi mi-sm">send</span>
                            </button>
                        </div>
                    </div>,
                    panelHost
                )}
        </>
    );
}
