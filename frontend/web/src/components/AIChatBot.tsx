import { useState, useRef, useEffect } from 'react';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
}

const AI_RESPONSES: Record<string, string> = {
    'help': 'I can help you with:\n• Summarize the meeting\n• Generate action items\n• Answer questions about QS-VC features\n• Provide meeting tips',
    'summarize': 'Based on the current meeting, I\'ll generate a summary once the discussion progresses. I track key points, decisions, and action items mentioned during the conversation.',
    'action items': 'I\'ll compile action items as they are discussed. You can ask me again at the end of the meeting for a complete list.',
    'features': 'QS-VC includes:\n• Post-Quantum E2EE encryption\n• AI-powered noise suppression\n• Real-time captions in 22 languages\n• Virtual backgrounds\n• Screen sharing & recording\n• Smart meeting summaries',
};

function getAIResponse(input: string): string {
    const lower = input.toLowerCase();
    for (const [key, response] of Object.entries(AI_RESPONSES)) {
        if (lower.includes(key)) return response;
    }
    return "I'm QS-VC's AI assistant. I can help summarize meetings, track action items, and answer questions about platform features. How can I help?";
}

export default function AIChatBot() {
    const [open, setOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([
        { id: '0', role: 'assistant', content: 'Hi! I\'m your AI meeting assistant. Ask me to summarize, track action items, or type "help" for more options.' },
    ]);
    const [input, setInput] = useState('');
    const [typing, setTyping] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, typing]);

    const handleSend = () => {
        const text = input.trim();
        if (!text) return;

        const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: text };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setTyping(true);

        setTimeout(() => {
            const aiMsg: Message = { id: `a-${Date.now()}`, role: 'assistant', content: getAIResponse(text) };
            setMessages(prev => [...prev, aiMsg]);
            setTyping(false);
        }, 800 + Math.random() * 700);
    };

    if (!open) {
        return (
            <button className="ai-fab" onClick={() => setOpen(true)} title="AI Assistant">
                <span className="mi">smart_toy</span>
            </button>
        );
    }

    return (
        <div className="ai-chat-panel">
            <div className="ai-chat-header">
                <div className="ai-chat-header-left">
                    <div className="ai-avatar"><span className="mi">smart_toy</span></div>
                    <div>
                        <div className="ai-chat-title">QS-VC AI</div>
                        <div className="ai-chat-subtitle">Meeting Assistant</div>
                    </div>
                </div>
                <button className="panel-close" onClick={() => setOpen(false)}>
                    <span className="mi mi-sm">close</span>
                </button>
            </div>

            <div className="ai-messages" ref={scrollRef}>
                {messages.map(msg => (
                    <div key={msg.id} className={`ai-msg ${msg.role}`}>
                        <div className="ai-msg-bubble" style={{ whiteSpace: 'pre-line' }}>
                            {msg.content}
                        </div>
                    </div>
                ))}
                {typing && (
                    <div className="ai-msg assistant">
                        <div className="ai-typing">
                            <div className="ai-typing-dot" />
                            <div className="ai-typing-dot" />
                            <div className="ai-typing-dot" />
                        </div>
                    </div>
                )}
            </div>

            <div className="ai-chat-input-area">
                <input
                    type="text"
                    className="ai-chat-input"
                    placeholder="Ask AI anything..."
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
                />
                <button className="ai-send-btn" onClick={handleSend}>
                    <span className="mi mi-sm">send</span>
                </button>
            </div>
        </div>
    );
}
