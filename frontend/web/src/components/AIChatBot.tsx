import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import '../styles/ai-assistant.css';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
}

const AI_RESPONSES: Record<string, string> = {
    help: 'Use Camera and Mic to manage your devices. Share presents a screen. More contains views and extra controls.',
    summar: 'I can explain the controls, but I cannot read or summarise your meeting.',
    'action items': 'I do not track the conversation. Add your next steps to the meeting chat so participants can read them.',
    record: 'Recording is not currently available. Paid recording is planned.',
    camera: 'Start your camera from the side controls. Switching tabs turns it off. Start it again when you return.',
    features: 'You can share your screen, exchange messages, change the meeting view and send reactions.',
};

function getAIResponse(input: string): string {
    const lower = input.toLowerCase();
    for (const [key, response] of Object.entries(AI_RESPONSES)) {
        if (lower.includes(key)) return response;
    }
    return 'I can explain the meeting controls. Try asking about your camera, recording or views. I do not analyse your meeting.';
}

export default function AIChatBot({ onOpen, closeSignal = false }: { onOpen?: () => void; closeSignal?: boolean }) {
    const [open, setOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([
        { id: '0', role: 'assistant', content: 'Need a hand with the meeting? Ask about the controls. I do not read your conversation.' },
    ]);
    const [input, setInput] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const restoreFocus = useRef(false);
    const close = () => { restoreFocus.current = true; setOpen(false); };
    useEffect(() => { if (closeSignal) setOpen(false); }, [closeSignal]);
    useEffect(() => {
        if (open) inputRef.current?.focus();
        else if (restoreFocus.current) { triggerRef.current?.focus(); restoreFocus.current = false; }
    }, [open]);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSend = () => {
        const text = input.trim();
        if (!text) return;

        const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: text };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        const aiMsg: Message = { id: `a-${Date.now()}`, role: 'assistant', content: getAIResponse(text) };
        setMessages(prev => [...prev, aiMsg]);
    };

    const panelHost = triggerRef.current?.closest('.meeting-room');
    return <>
        <button type="button" ref={triggerRef} className="ai-fab qsvc-assistant-launcher" aria-label={open ? 'Close meeting assistant' : 'Open meeting assistant'} aria-expanded={open} aria-controls={open ? 'meeting-assistant-panel' : undefined} onClick={() => { if (open) close(); else { onOpen?.(); setOpen(true); } }} title="Meeting assistant">
            <svg className="qsvc-assistant-symbol" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path d="M39 33 C41 30 42 27 42 23 C42 13 34 5 24 5 C14 5 6 13 6 23 C6 33 14 41 24 41 C27 41 30 40 33 39 L42 43 Z" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" /><g className="qsvc-assistant-eyes" fill="currentColor"><path d="M15 17 L22 23 L15 29 Z" /><path d="M33 17 L26 23 L33 29 Z" /></g></svg>
        </button>
        {open && panelHost && createPortal(<div id="meeting-assistant-panel" className="ai-chat-panel" role="complementary" aria-label="Meeting assistant" onKeyDown={event => { if (event.key === 'Escape') close(); }}>
            <div className="ai-chat-header">
                <div className="ai-chat-header-left">
                    <div className="ai-avatar"><span className="mi">forum</span></div>
                    <div>
                        <div className="ai-chat-title">Meeting assistant</div>
                        <div className="ai-chat-subtitle">Controls help · Only visible to you</div>
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

            <div className="ai-chat-input-area">
                <input
                    ref={inputRef}
                    type="text"
                    className="ai-chat-input"
                    aria-label="Message to meeting assistant" placeholder="Ask a question…"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
                />
                <button className="ai-send-btn" aria-label="Send to meeting assistant" onClick={handleSend}>
                    <span className="mi mi-sm">send</span>
                </button>
            </div>
        </div>, panelHost)}
    </>;
}
