import { useEffect, useState } from 'react';
import '../styles/private-conversation.css';

export interface PrivateConversationInvite {
    conversationId: string;
    otherDisplayName: string;
    otherPeerId?: string;
    direction: 'incoming' | 'outgoing';
    durationMs?: number | null;
}

export interface ActivePrivateConversation {
    conversationId: string;
    otherDisplayName: string;
    otherPeerId?: string;
    endsAt: string | null;
    durationMs: number | null;
    otherMicrophoneMuted?: boolean;
}

interface Props {
    invite: PrivateConversationInvite | null;
    active: ActivePrivateConversation | null;
    microphoneMuted: boolean;
    focusAudio: boolean;
    onAccept: () => void;
    onDecline: () => void;
    onCancel: () => void;
    onEnd: () => void;
    onToggleMicrophone: () => void;
    onToggleFocusAudio: () => void;
}

function durationText(durationMs?: number | null): string {
    if (durationMs === null) return 'Unlimited';
    if (!durationMs || durationMs <= 0) return 'Limited time';
    return durationMs >= 60_000 ? `${Math.ceil(durationMs / 60_000)} min` : `${Math.ceil(durationMs / 1000)} sec`;
}

export default function PrivateConversationPanel({ invite, active, microphoneMuted, focusAudio, onAccept, onDecline, onCancel, onEnd, onToggleMicrophone, onToggleFocusAudio }: Props) {
    const [now, setNow] = useState(Date.now());
    const [timeWarning, setTimeWarning] = useState('');
    useEffect(() => {
        if (!active?.endsAt) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [active?.endsAt]);
    useEffect(() => { setTimeWarning(''); }, [active?.conversationId]);
    const remaining = active?.endsAt ? Math.max(0, Math.ceil((new Date(active.endsAt).getTime() - now) / 1000)) : null;
    const timeLabel = remaining === null ? 'Unlimited' : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} left`;
    useEffect(() => {
        if (remaining !== null && remaining > 0 && remaining <= 30 && !timeWarning) setTimeWarning('Private conversation ends in 30 seconds or less.');
    }, [remaining, timeWarning]);

    if (invite) {
        const incoming = invite.direction === 'incoming';
        return <aside className="private-conversation-card" aria-live="polite" aria-label={incoming ? 'Private conversation invitation' : 'Private conversation invitation sent'}>
            <div className="private-conversation-heading">
                <span className="private-conversation-icon mi" aria-hidden="true">{incoming ? 'call' : 'hourglass_top'}</span>
                <div><strong>{incoming ? 'Private conversation' : 'Waiting for a response'}</strong>
                    <span>{incoming ? `${invite.otherDisplayName} wants to speak with you.` : `Invitation sent to ${invite.otherDisplayName}.`}</span></div>
            </div>
            <p className="private-conversation-note">If accepted, you’ll stay in the meeting while both meeting microphones are muted. Only you and {invite.otherDisplayName} will hear the side conversation, and you can lower or mute the main meeting audio while you listen. {incoming && `Time limit: ${durationText(invite.durationMs)}.`}</p>
            {incoming ? <div className="private-conversation-actions">
                <button type="button" className="private-conversation-primary" onClick={onAccept}>Accept</button>
                <button type="button" className="private-conversation-secondary" onClick={onDecline}>Decline</button>
            </div> : <div className="private-conversation-actions">
                <span className="private-conversation-limit">{durationText(invite.durationMs)}</span>
                <button type="button" className="private-conversation-secondary" onClick={onCancel}>Cancel invite</button>
            </div>}
        </aside>;
    }

    if (!active) return null;
    return <aside className="private-conversation-card private-conversation-card--active" aria-label={`Private conversation with ${active.otherDisplayName}`}>
        <div className="private-conversation-heading">
            <span className="private-conversation-icon mi" aria-hidden="true">call</span>
            <div><strong>Talking privately with {active.otherDisplayName}</strong>
                <span className="private-conversation-active-label"><i aria-hidden="true" /> Only the two of you can hear this call</span></div>
        </div>
        <div className="private-conversation-toolbar">
            <span className={`private-conversation-limit${remaining !== null && remaining <= 30 ? ' is-urgent' : ''}`}>{timeLabel}</span>
            <span className="private-conversation-sr-only" aria-live="polite">{timeWarning}</span>
            <button type="button" className="private-conversation-secondary" aria-pressed={!microphoneMuted} onClick={onToggleMicrophone}>
                <span className="mi mi-sm" aria-hidden="true">{microphoneMuted ? 'mic_off' : 'mic'}</span>{microphoneMuted ? 'Unmute private mic' : 'Mute private mic'}
            </button>
            <button type="button" className="private-conversation-secondary" aria-pressed={focusAudio} onClick={onToggleFocusAudio}>
                <span className="mi mi-sm" aria-hidden="true">{focusAudio ? 'hearing' : 'volume_down'}</span>{focusAudio ? 'Hear meeting' : 'Focus on them'}
            </button>
            <button type="button" className="private-conversation-end" onClick={onEnd}>End conversation</button>
        </div>
        <p className="private-conversation-note">Your main meeting microphone is muted. {active.otherMicrophoneMuted ? `${active.otherDisplayName} has their private mic muted. ` : ''}{focusAudio ? 'Main meeting audio is muted for you.' : 'You can still hear the main meeting in the background.'}</p>
    </aside>;
}
