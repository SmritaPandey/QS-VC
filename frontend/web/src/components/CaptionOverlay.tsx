import { useEffect, useRef, useState, type CSSProperties } from 'react';
import '../styles/caption-overlay.css';

export interface CaptionEntry {
    id: string;
    peerId?: string;
    speakerName: string;
    text: string;
    isFinal: boolean;
    timestamp: number;
    /** Local receipt time keeps captions readable despite remote clock differences. */
    receivedAt?: number;
    language?: string;
    label?: string;
}

interface Props {
    enabled: boolean;
    captions: CaptionEntry[];
    fontSize?: 'small' | 'medium' | 'large' | 'xlarge';
}

export function captionExpiresAt(caption: CaptionEntry): number {
    const readingTime = caption.isFinal ? Math.min(12000, Math.max(6000, caption.text.length * 50)) : 5000;
    return (caption.receivedAt ?? caption.timestamp) + readingTime;
}

export function visibleCaptionEntries(captions: CaptionEntry[], now: number): CaptionEntry[] {
    return captions.filter(caption => caption.text.trim() && captionExpiresAt(caption) > now).slice(-2);
}

const sizes = { small: '16px', medium: '16px', large: '18px', xlarge: '22px' };

export default function CaptionOverlay({ enabled, captions, fontSize = 'medium' }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [clock, setClock] = useState(Date.now);
    const now = Math.max(clock, Date.now());
    useEffect(() => {
        if (!enabled) return;
        const current = Date.now();
        const expiry = captions.map(captionExpiresAt).filter(value => value > current);
        if (!expiry.length) return;
        const timer = window.setTimeout(() => setClock(Date.now()), Math.min(...expiry) - current + 1);
        return () => window.clearTimeout(timer);
    }, [captions, enabled, clock]);
    const visible = visibleCaptionEntries(captions, now);
    useEffect(() => {
        containerRef.current?.querySelectorAll<HTMLElement>('.caption-text').forEach(line => { line.scrollTop = line.scrollHeight; });
    }, [captions, enabled]);
    if (!enabled || !visible.length) return null;
    return <div className="caption-overlay meeting-live-captions" style={{ '--caption-size': sizes[fontSize] } as CSSProperties}>
        <div className="caption-container" ref={containerRef} role="log" aria-label="Meeting captions" aria-live="polite" aria-relevant="additions text">
            {visible.map((caption, index) => <div key={caption.id} className="caption-line" data-speaker={caption.peerId || undefined} data-current={index === visible.length - 1} data-final={caption.isFinal}>
                <div className="caption-line-heading">
                    <span className="caption-speaker-mark" aria-hidden="true">{caption.speakerName.trim().slice(0, 1).toLocaleUpperCase() || '?'}</span>
                    <span className="caption-speaker">{caption.speakerName || 'Participant'}</span>
                    {caption.label && caption.label !== 'Original' && <span className="caption-origin">{caption.label}</span>}
                </div>
                <div className="caption-text" tabIndex={0} aria-label={`Caption from ${caption.speakerName}`} lang={caption.language} dir="auto">{caption.text}</div>
            </div>)}
        </div>
    </div>;
}
