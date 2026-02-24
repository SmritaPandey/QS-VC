/**
 * Live caption overlay component.
 * Displays real-time captions from STT engine at the bottom of the meeting view.
 */
import React, { useEffect, useRef } from 'react';

export interface CaptionEntry {
    id: string;
    speakerName: string;
    text: string;
    isFinal: boolean;
    timestamp: number;
}

interface Props {
    enabled: boolean;
    captions: CaptionEntry[];
    fontSize?: 'small' | 'medium' | 'large' | 'xlarge';
}

const fontSizeMap = {
    small: '12px',
    medium: '14px',
    large: '18px',
    xlarge: '22px',
};

const CaptionOverlay: React.FC<Props> = ({ enabled, captions, fontSize = 'medium' }) => {
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [captions]);

    if (!enabled || captions.length === 0) return null;

    // Show only last 3 captions
    const visibleCaptions = captions.slice(-3);

    return (
        <div className="caption-overlay" style={{ fontSize: fontSizeMap[fontSize] }}>
            <div className="caption-container" ref={scrollRef}>
                {visibleCaptions.map(c => (
                    <div key={c.id} className={`caption-line ${c.isFinal ? '' : 'caption-partial'}`}>
                        <span className="caption-speaker">{c.speakerName}:</span>
                        <span className="caption-text">{c.text}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default CaptionOverlay;
