import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';

interface Message {
    id: string;
    peerId: string;
    displayName: string;
    content: string;
    timestamp: string;
}

interface Props {
    messages: Message[];
    myPeerId: string;
    onSend: (content: string) => Promise<boolean>;
    onClose: () => void;
}

export default function MeetingChat({ messages, myPeerId, onSend, onClose }: Props) {
    const logRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const nearBottom = useRef(true);
    const previousCount = useRef(0);
    const closeRef = useRef<HTMLButtonElement>(null);
    const pending = useRef(false);
    const [deliveryFailed, setDeliveryFailed] = useState(false);
    const [sending, setSending] = useState(false);
    const [hasNewMessages, setHasNewMessages] = useState(false);
    const [draft, setDraft] = useState('');

    const jumpToLatest = () => {
        const log = logRef.current;
        if (log) log.scrollTop = log.scrollHeight;
        nearBottom.current = true;
        setHasNewMessages(false);
    };

    useLayoutEffect(() => {
        const log = logRef.current;
        const list = listRef.current;
        if (!log || !list) return;
        const follow = () => {
            if (nearBottom.current) log.scrollTop = log.scrollHeight;
        };
        follow();
        if (messages.length > previousCount.current && !nearBottom.current) setHasNewMessages(true);
        previousCount.current = messages.length;
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(follow);
        observer?.observe(list);
        observer?.observe(log);
        return () => observer?.disconnect();
    }, [messages]);

    useLayoutEffect(() => { closeRef.current?.focus({ preventScroll: true }); }, []);

    const send = async (event: FormEvent) => {
        event.preventDefault();
        const content = draft.trim();
        if (!content || pending.current) return;
        pending.current = true;
        setSending(true);
        setDeliveryFailed(false);
        try {
            if (await onSend(content)) {
                setDraft(current => current === draft ? '' : current);
                jumpToLatest();
            } else {
                setDeliveryFailed(true);
            }
        } finally {
            pending.current = false;
            setSending(false);
        }
    };

    return <div className="side-panel meeting-chat-overlay" id="meeting-chat-panel" role="complementary" aria-label="Meeting chat" onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    }}>
        <div className="panel-header">
            <h3>In-call messages</h3>
            <button ref={closeRef} type="button" className="panel-close" aria-label="Close chat" onClick={onClose}><span className="mi mi-sm" aria-hidden="true">close</span></button>
        </div>
        <div ref={logRef} className="chat-messages" role="log" tabIndex={0} aria-label="Meeting chat history" aria-live="polite" aria-relevant="additions text"
            onScroll={() => {
                const log = logRef.current;
                if (!log) return;
                nearBottom.current = log.scrollHeight - log.scrollTop - log.clientHeight < 32;
                if (nearBottom.current) setHasNewMessages(false);
            }}>
            <div ref={listRef} className="chat-feed-list">
                {messages.length === 0 ? <div className="chat-empty">Start the conversation.</div> : messages.map(message => <div key={message.id} className="chat-msg" data-own={myPeerId === message.peerId || undefined}>
                    <div className="chat-message-meta">
                        <span className="chat-sender">{myPeerId === message.peerId ? 'You' : message.displayName}</span>
                        {Number.isFinite(Date.parse(message.timestamp)) && <time dateTime={message.timestamp}>{new Date(message.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>}
                    </div>
                    <p className="chat-text">{message.content}</p>
                </div>)}
            </div>
        </div>
        {hasNewMessages && <button type="button" className="chat-new-messages" onClick={jumpToLatest}>New messages <span className="mi mi-sm" aria-hidden="true">south</span></button>}
        {deliveryFailed && <p className="chat-delivery-error" role="status">Message could not be sent. Your draft is ready to retry.</p>}
        <form className="chat-input-area" onSubmit={send}>
            <input type="text" aria-label="Chat message" placeholder="Message everyone…" className="chat-input" value={draft} onChange={event => setDraft(event.target.value)} />
            <button type="submit" className="chat-send-btn" aria-label="Send message" disabled={sending || !draft.trim()}><span className="mi mi-sm" aria-hidden="true">send</span></button>
        </form>
    </div>;
}
