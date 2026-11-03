import { useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';

interface Message {
    id: string;
    displayName: string;
    content: string;
    timestamp: string;
}

interface Props {
    messages: Message[];
    onSend: (content: string) => void;
    onClose: () => void;
}

export default function MeetingChat({ messages, onSend, onClose }: Props) {
    const logRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const nearBottom = useRef(true);
    const previousCount = useRef(0);
    const [recentHeight, setRecentHeight] = useState(260);
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
        const mobile = window.matchMedia('(max-width: 767px)');
        const measure = () => {
            const recent = Array.from(list.children).slice(mobile.matches ? -4 : -6);
            const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
            const height = recent.reduce((sum, item) => sum + item.getBoundingClientRect().height, 0) + Math.max(0, recent.length - 1) * gap;
            setRecentHeight(current => Math.abs(current - height) > 0.5 ? Math.ceil(height) : current);
            if (nearBottom.current) log.scrollTop = log.scrollHeight;
        };
        measure();
        if (messages.length > previousCount.current && !nearBottom.current) setHasNewMessages(true);
        previousCount.current = messages.length;
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
        observer?.observe(list);
        mobile.addEventListener('change', measure);
        window.addEventListener('resize', measure);
        return () => {
            observer?.disconnect();
            mobile.removeEventListener('change', measure);
            window.removeEventListener('resize', measure);
        };
    }, [messages]);

    // Height changes can shrink the viewport after measuring; keep the latest bubble in view only for followers.
    useLayoutEffect(() => {
        if (nearBottom.current && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [recentHeight]);

    const send = (event: FormEvent) => {
        event.preventDefault();
        const content = draft.trim();
        if (!content) return;
        nearBottom.current = true;
        onSend(content);
        setDraft('');
    };

    return <div className="side-panel meeting-chat-overlay" id="meeting-chat-panel" role="complementary" aria-label="Meeting chat" onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    }}>
        <div className="panel-header">
            <button type="button" className="panel-close" aria-label="Close chat" onClick={onClose}><span className="mi mi-sm" aria-hidden="true">close</span></button>
        </div>
        <div ref={logRef} className="chat-messages" role="log" tabIndex={0} aria-label="Meeting chat history" aria-live="polite" aria-relevant="additions text"
            style={{ '--recent-chat-height': `${recentHeight}px` } as CSSProperties}
            onScroll={() => {
                const log = logRef.current;
                if (!log) return;
                nearBottom.current = log.scrollHeight - log.scrollTop - log.clientHeight < 32;
                if (nearBottom.current) setHasNewMessages(false);
            }}>
            <div ref={listRef} className="chat-feed-list">
                {messages.length === 0 ? <div className="chat-empty">Start the conversation.</div> : messages.map(message => <div key={message.id} className="chat-msg">
                    <span className="chat-sender">{message.displayName}</span>
                    <p className="chat-text">{message.content}</p>
                </div>)}
            </div>
        </div>
        {hasNewMessages && <button type="button" className="chat-new-messages" onClick={jumpToLatest}>New messages <span className="mi mi-sm" aria-hidden="true">south</span></button>}
        <form className="chat-input-area" onSubmit={send}>
            <input type="text" aria-label="Chat message" placeholder="Message everyone…" className="chat-input" value={draft} onChange={event => setDraft(event.target.value)} />
            <button type="submit" className="chat-send-btn" aria-label="Send message" disabled={!draft.trim()}><span className="mi mi-sm" aria-hidden="true">send</span></button>
        </form>
    </div>;
}
