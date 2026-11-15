import { useEffect, useState, type ReactNode } from 'react';
import '../styles/meeting-notifications.css';

/** Short-lived feedback pauses while someone reads or uses its controls. */
export default function MeetingToast({ children, onDismiss, duration = 6000, className = '' }: {
    children: ReactNode; onDismiss: () => void; duration?: number; className?: string;
}) {
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    useEffect(() => {
        if (hovered || focused) return;
        const timer = window.setTimeout(onDismiss, duration);
        return () => window.clearTimeout(timer);
    }, [duration, hovered, focused, onDismiss]);
    return <div className={`meeting-feedback ${className}`} role="status" aria-live="polite" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
        <div className="meeting-feedback-content">{children}</div>
        <button type="button" className="meeting-feedback-dismiss" aria-label="Dismiss notification" onClick={onDismiss}><span className="mi" aria-hidden="true">close</span></button>
    </div>;
}
