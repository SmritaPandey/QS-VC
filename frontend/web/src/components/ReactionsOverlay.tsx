import { useState, useEffect } from 'react';

interface Reaction {
    id: string;
    emoji: string;
    displayName: string;
    timestamp: number;
}

interface Props {
    onSendReaction: (emoji: string) => void;
}

const REACTION_EMOJIS = ['👍', '❤️', '😂', '👏', '🎉', '🤔', '😮', '🔥'];
const REACTION_DURATION = 3000;

export default function ReactionsOverlay({ onSendReaction }: Props) {
    const [reactions, setReactions] = useState<Reaction[]>([]);
    const [pickerOpen, setPickerOpen] = useState(false);

    // Auto-remove expired reactions
    useEffect(() => {
        const interval = setInterval(() => {
            setReactions(prev => prev.filter(r => Date.now() - r.timestamp < REACTION_DURATION));
        }, 500);
        return () => clearInterval(interval);
    }, []);

    const addReaction = (emoji: string) => {
        const reaction: Reaction = {
            id: `${Date.now()}-${Math.random()}`,
            emoji,
            displayName: 'You',
            timestamp: Date.now(),
        };
        setReactions(prev => [...prev, reaction]);
        onSendReaction(emoji);
        setPickerOpen(false);
    };

    return (
        <>
            {/* Floating reactions */}
            <div className="reactions-container">
                {reactions.map((r) => (
                    <div key={r.id} className="floating-reaction" style={{
                        left: `${20 + Math.random() * 60}%`,
                        animationDelay: `${Math.random() * 0.3}s`,
                    }}>
                        <span className="reaction-emoji">{r.emoji}</span>
                    </div>
                ))}
            </div>

            {/* Reaction picker */}
            {pickerOpen && (
                <div className="reaction-picker">
                    {REACTION_EMOJIS.map((emoji) => (
                        <button
                            key={emoji}
                            className="reaction-pick-btn"
                            onClick={() => addReaction(emoji)}
                        >
                            {emoji}
                        </button>
                    ))}
                </div>
            )}
        </>
    );
}

export { REACTION_EMOJIS };
