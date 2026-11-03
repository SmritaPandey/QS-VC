import { useEffect, useRef, useState } from 'react';
import { playReactionSound, readReactionPreferences, saveReactionPreferences, type ReactionSound, type ReactionEffect } from '../lib/reaction-sounds';
import '../styles/reaction-effects.css';

export interface MeetingReaction {
    id: string;
    emoji: string;
    displayName: string;
    mine: boolean;
    /** horizontal start position, % of the video area */
    x: number;
    /** sideways drift while rising, px */
    drift: number;
}

interface Props {
    reactions: MeetingReaction[];
    pickerOpen: boolean;
    onSendReaction: (emoji: string) => void;
    onClosePicker: () => void;
    onExpire: (id: string) => void;
}

const REACTION_EMOJIS = ['👍', '❤️', '😂', '👏', '🎉', '🤔', '😮', '🔥'];
const REACTION_LABELS: Record<string, string> = {
    '👍': 'Thumbs up', '❤️': 'Heart', '😂': 'Laugh', '👏': 'Clap', '🎉': 'Celebrate', '🤔': 'Thinking', '😮': 'Surprised', '🔥': 'Fire',
};
export const REACTION_DURATION = 3200;

export default function ReactionsOverlay({ reactions, pickerOpen, onSendReaction, onClosePicker, onExpire }: Props) {
    const pickerRef = useRef<HTMLDivElement>(null);
    const [preferences, setPreferences] = useState(readReactionPreferences);
    const changePreference = (key: 'sound' | 'effect', value: ReactionSound | ReactionEffect) => {
        const next = { ...preferences, [key]: value };
        setPreferences(next);
        saveReactionPreferences(next);
    };

    // Focus the first emoji when the picker opens; Escape closes it; arrows move between emojis.
    useEffect(() => {
        if (!pickerOpen) return;
        const picker = pickerRef.current;
        picker?.querySelector<HTMLButtonElement>('button')?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClosePicker();
                document.querySelector<HTMLButtonElement>('[aria-controls="reaction-picker"]')?.focus();
                return;
            }
            if (!picker || !picker.contains(document.activeElement)) return;
            if (!(document.activeElement instanceof HTMLButtonElement) || !document.activeElement.classList.contains('reaction-pick-btn')) return;
            const buttons = [...picker.querySelectorAll<HTMLButtonElement>('.reaction-pick-btn')];
            const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (e.key === 'ArrowRight') { e.preventDefault(); buttons[(i + 1) % buttons.length].focus(); }
            if (e.key === 'ArrowLeft') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [pickerOpen, onClosePicker]);

    const send = (emoji: string) => {
        void playReactionSound(preferences.sound);
        onSendReaction(emoji);
    };

    return (
        <>
            {/* Floating reactions: tap one to send the same reaction back (+1). */}
            <div className="reactions-stage" aria-live="polite" aria-relevant="additions">
                {reactions.map((r) => (
                    <button
                        type="button"
                        key={r.id}
                        className={`floating-reaction ${r.mine ? 'is-mine' : ''}`}
                        data-effect={r.mine ? preferences.effect : 'none'}
                        style={{ left: `${r.x}%`, ['--drift' as string]: `${r.drift}px` }}
                        onAnimationEnd={event => { if (event.target === event.currentTarget) onExpire(r.id); }}
                        onClick={() => send(r.emoji)}
                        aria-label={`${r.displayName} reacted ${REACTION_LABELS[r.emoji] ?? r.emoji}. Send the same reaction`}
                    >
                        <span className="reaction-emoji">{r.emoji}</span>
                        {r.mine && preferences.effect !== 'none' && <span className="reaction-effect-ring" aria-hidden="true" />}
                        <span className="reaction-name">{r.mine ? 'You' : r.displayName}</span>
                    </button>
                ))}
            </div>

            {pickerOpen && (
                <div className="reaction-picker reaction-picker-personal" id="reaction-picker" role="group" aria-label="Reactions and personal effects" ref={pickerRef}>
                    <div className="reaction-emoji-row" role="toolbar" aria-label="Send a reaction">
                    {REACTION_EMOJIS.map((emoji, i) => (
                        <button
                            type="button"
                            key={emoji}
                            className="reaction-pick-btn"
                            style={{ ['--i' as string]: i }}
                            onClick={() => send(emoji)}
                            aria-label={REACTION_LABELS[emoji]}
                            title={REACTION_LABELS[emoji]}
                        >
                            <span aria-hidden="true">{emoji}</span>
                        </button>
                    ))}
                    </div>
                    <div className="reaction-preferences">
                        <label>Sound<select value={preferences.sound} onChange={event => changePreference('sound', event.target.value as ReactionSound)}><option value="off">Off</option><option value="chime">Chime</option><option value="pop">Pop</option><option value="sparkle">Sparkle</option></select></label>
                        <label>Effect<select value={preferences.effect} onChange={event => changePreference('effect', event.target.value as ReactionEffect)}><option value="subtle">Soft glow</option><option value="celebrate">Celebrate</option><option value="none">None</option></select></label>
                        <button type="button" className="reaction-sound-preview" disabled={preferences.sound === 'off'} onClick={() => { void playReactionSound(preferences.sound); }}>Preview sound</button>
                    </div>
                    <p className="reaction-private-note">Sounds and extra effects are just for you. Shared tab or device audio may include sounds.</p>
                </div>
            )}
        </>
    );
}
