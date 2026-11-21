import { useEffect, useRef, useState, type ReactNode } from 'react';
import '../styles/meeting-notifications.css';

/** Short-lived feedback pauses while someone reads or uses its controls. */
export default function MeetingToast({ children, onDismiss, duration = 6000, className = '' }: {
    children: ReactNode; onDismiss: () => void; duration?: number; className?: string;
}) {
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const onDismissRef = useRef(onDismiss);
    onDismissRef.current = onDismiss;

    useEffect(() => {
        if (hovered || focused) return;
        const timer = window.setTimeout(() => {
            onDismissRef.current();
        }, duration);
        return () => window.clearTimeout(timer);
    }, [duration, hovered, focused]);

    return <div className={`meeting-feedback ${className}`} role="status" aria-live="polite" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
        <div className="meeting-feedback-content">{children}</div>
        <button type="button" className="meeting-feedback-dismiss" aria-label="Dismiss notification" onClick={() => onDismissRef.current()}><span className="mi" aria-hidden="true">close</span></button>
    </div>;
}

/** One timed notice per uninterrupted connection state, even as new stats arrive. */
export function ConnectionNotice({ message, onOpenQuality }: { message: string; onOpenQuality: () => void }) {
    const [dismissed, setDismissed] = useState(false);
    const dismiss = () => setDismissed(true);
    if (dismissed) return null;
    return <MeetingToast onDismiss={dismiss}>
        <span>{message}</span>
        <button type="button" className="btn-text" onClick={() => { dismiss(); onOpenQuality(); }}>Connection quality</button>
    </MeetingToast>;
}
