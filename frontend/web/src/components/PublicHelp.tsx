import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { productReply, type ProductReply } from '../lib/public-help-replies';
import '../styles/public-help.css';

interface GuideMessage extends ProductReply { id: number; role: 'user' | 'assistant' }

export default function PublicHelp({ navigationOpen = false }: { navigationOpen?: boolean }) {
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<GuideMessage[]>([{ id: 0, role: 'assistant', text: 'Ask me about QS-VC. I can help with joining, languages, plans and hosting.' }]);
    const nextId = useRef(1);
    const trigger = useRef<HTMLButtonElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const logRef = useRef<HTMLDivElement>(null);
    const panelId = useId();
    const titleId = useId();
    const close = () => { setOpen(false); trigger.current?.focus(); };
    useEffect(() => { if (navigationOpen) setOpen(false); }, [navigationOpen]);
    useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
    useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [messages, open]);

    const send = (question: string) => {
        const text = question.trim().slice(0, 500);
        if (!text) return;
        const user: GuideMessage = { id: nextId.current++, role: 'user', text };
        const reply: GuideMessage = { id: nextId.current++, role: 'assistant', ...productReply(text) };
        setMessages(previous => [...previous, user, reply].slice(-40));
        setInput('');
        inputRef.current?.focus();
    };
    const submit = (event: FormEvent) => { event.preventDefault(); send(input); };

    return <div className="public-help" hidden={navigationOpen} onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); close(); } }}>
        {open && <section id={panelId} className="public-help-panel" role="dialog" aria-labelledby={titleId}>
            <div className="public-help-heading"><div><h2 id={titleId}>QS-VC assistant</h2><p>Product guide</p></div><button type="button" className="public-help-close" aria-label="Close help" onClick={close}><span className="mi" aria-hidden="true">close</span></button></div>
            <div ref={logRef} className="public-help-messages" role="log" aria-label="Product guide conversation" aria-live="polite" aria-relevant="additions">
                {messages.map(message => <div className={`public-help-message public-help-message--${message.role}`} key={message.id}><span className="sr-only">{message.role === 'user' ? 'You: ' : 'QS-VC guide: '}</span><p>{message.text}</p>{message.link && <Link to={message.link.to}>{message.link.label}<span aria-hidden="true"> →</span></Link>}</div>)}
            </div>
            <div className="public-help-suggestions" aria-label="Suggested questions">{['Join a meeting', 'Language options', 'Plans and pricing'].map(question => <button type="button" key={question} onClick={() => send(question)}>{question}</button>)}</div>
            <form className="public-help-composer" onSubmit={submit}>
                <input ref={inputRef} type="text" maxLength={500} value={input} onChange={event => setInput(event.target.value)} aria-label="Ask the QS-VC product guide" placeholder="Ask about QS-VC…" />
                <button type="submit" aria-label="Send question" disabled={!input.trim()}><span className="mi" aria-hidden="true">arrow_upward</span></button>
            </form>
        </section>}
        <button ref={trigger} type="button" className="public-help-launcher" aria-label={open ? 'Close QS-VC help' : 'Open QS-VC help'} aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => open ? close() : setOpen(true)}>
            <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path d="M39 33 C41 30 42 27 42 23 C42 13 34 5 24 5 C14 5 6 13 6 23 C6 33 14 41 24 41 C27 41 30 40 33 39 L42 43 Z" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"/><g className="public-help-eyes" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M15 17 L22 23 L15 29 Z"/><path d="M33 17 L26 23 L33 29 Z"/></g></svg>
        </button>
    </div>;
}
