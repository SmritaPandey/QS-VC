import { useState, type CSSProperties } from 'react';
import { isOnStage } from '../lib/meeting-layout';
import { signaling } from '../lib/signaling';

interface PeerData {
    peerId: string;
    displayName: string;
    audioTrack?: MediaStreamTrack;
    videoTrack?: MediaStreamTrack;
    role?: string;
    audioMuted?: boolean;
    videoOff?: boolean;
    handRaised?: boolean;
    presenting?: boolean;
    onStage?: boolean;
}

interface Props {
    peers: Map<string, PeerData>;
    displayName: string;
    myPeerId?: string;
    myRole?: string;
    myOnStage?: boolean;
    audioMuted?: boolean;
    videoOff?: boolean;
    handRaised?: boolean;
    presenting?: boolean;
    speaking?: Set<string>;
    webinar?: boolean;
    spotlightId?: string | null;
    canManage?: boolean;
    onSpotlight?: (peerId: string | null) => void;
    onToggleStage?: (peerId: string, onStage: boolean) => void;
    canStartPrivateConversation?: boolean;
    privateConversationLimitLabel?: string;
    privateConversationPeerId?: string | null;
    privateConversationStatus?: 'idle' | 'outgoing' | 'active';
    onStartPrivateConversation?: (peerId: string) => void;
    onClose: () => void;
}

type Row = { peerId: string; displayName: string; isLocal: boolean; role?: string; micOn: boolean; camOn: boolean; handRaised: boolean; presenting: boolean; onStage?: boolean };

export default function ParticipantsPanel({ peers, displayName, myPeerId = 'self', myRole = 'member', myOnStage = false, audioMuted = false, videoOff = false, handRaised = false, presenting = false, speaking = new Set(), webinar = false, spotlightId = null, canManage = false, onSpotlight, onToggleStage, canStartPrivateConversation = false, privateConversationLimitLabel = '2 min', privateConversationPeerId = null, privateConversationStatus = 'idle', onStartPrivateConversation, onClose }: Props) {
    const [searchQuery, setSearchQuery] = useState('');

    const all: Row[] = [
        { peerId: myPeerId, displayName: `${displayName} (You)`, isLocal: true, role: myRole, micOn: !audioMuted, camOn: !videoOff, handRaised, presenting, onStage: myOnStage },
        ...Array.from(peers.values()).map(p => ({
            peerId: p.peerId, displayName: p.displayName, isLocal: false, role: p.role, onStage: p.onStage,
            micOn: p.audioMuted !== undefined ? !p.audioMuted : !!p.audioTrack,
            camOn: p.videoOff !== undefined ? !p.videoOff && !!p.videoTrack : !!p.videoTrack,
            handRaised: !!p.handRaised, presenting: !!p.presenting,
        })),
    ];
    // Presenters and people speaking float to the top; raised hands next (as in Google Meet).
    const rank = (p: Row) => (p.presenting ? 0 : speaking.has(p.peerId) ? 1 : p.handRaised ? 2 : p.isLocal ? 3 : 4);
    const filtered = (searchQuery ? all.filter(p => p.displayName.toLowerCase().includes(searchQuery.toLowerCase())) : all)
        .sort((a, b) => rank(a) - rank(b));
    const groups: Array<[string, Row[]]> = webinar
        ? [['On stage', filtered.filter(p => isOnStage(p))], ['Audience', filtered.filter(p => !isOnStage(p))]]
        : [['In the meeting', filtered]];

    const handleMutePeer = async (peerId: string) => {
        try {
            await signaling.request('hostMutePeer', { targetPeerId: peerId, kind: 'audio' });
        } catch (e) {
            console.error('Failed to mute peer', e);
        }
    };

    const handleKickPeer = async (peerId: string, name: string) => {
        if (typeof window !== 'undefined' && !window.confirm(`Remove ${name} from this meeting?`)) return;
        try {
            await signaling.request('kickPeer', { targetPeerId: peerId });
        } catch (e) {
            console.error('Failed to remove peer', e);
        }
    };

    const handleChangeRole = async (peerId: string, newRole: string) => {
        try {
            await signaling.request('changeRole', { targetPeerId: peerId, newRole });
        } catch (e) {
            console.error('Failed to change role', e);
        }
    };

    const row = (p: Row) => {
        const isSpeaking = speaking.has(p.peerId) && p.micOn;
        const manageable = canManage && !p.isLocal && p.role !== 'host';
        const isPrivateConversationPeer = privateConversationPeerId === p.peerId;
        return <div key={p.peerId} className="participant-item" data-speaking={isSpeaking || undefined}>
            <div className="participant-avatar" data-speaking={isSpeaking || undefined}>{p.displayName[0]?.toUpperCase() || '?'}</div>
            <div className="participant-info">
                <span className="participant-name">{p.displayName}</span>
                <span className="participant-tags">
                    {p.role === 'host' && <span className="participant-role">Host</span>}
                    {p.role === 'co-host' && <span className="participant-role">Co-host</span>}
                    {p.role === 'guest' && <span className="participant-role host-guest-label">Guest</span>}
                    {(!p.role || p.role === 'member') && !p.isLocal && <span className="participant-role host-member-label">Member</span>}
                    {p.presenting && <span className="participant-tag participant-tag--present">Presenting</span>}
                    {spotlightId === p.peerId && <span className="participant-tag">Spotlight</span>}
                    {isSpeaking && <span className="participant-tag participant-tag--speaking">Speaking</span>}
                </span>
            </div>
            <div className="participant-status">
                {p.handRaised && <span className="status-icon mi mi-sm is-hand" title="Hand raised">front_hand</span>}
                {p.presenting && <span className="status-icon mi mi-sm" title="Presenting">present_to_all</span>}
                {isSpeaking ? <span className="qsvc-speaking" data-speaking="true" style={{ '--voice-level': '0.8' } as CSSProperties} role="img" aria-label="Speaking"><i /><i /><i /></span>
                    : <span className={`status-icon mi mi-sm ${p.micOn ? '' : 'is-off'}`} title={p.micOn ? 'Microphone on' : 'Microphone off'}>{p.micOn ? 'mic' : 'mic_off'}</span>}
                <span className={`status-icon mi mi-sm ${p.camOn ? '' : 'is-off'}`} title={p.camOn ? 'Camera on' : 'Camera off'}>{p.camOn ? 'videocam' : 'videocam_off'}</span>
                {manageable && p.micOn && (
                    <button type="button" className="participant-icon-action" aria-label={`Mute ${p.displayName}`} title="Mute participant" onClick={() => void handleMutePeer(p.peerId)}>
                        <span className="mi mi-sm" aria-hidden="true">mic_off</span>
                    </button>
                )}
                {manageable && webinar && onToggleStage && p.role !== 'co-host' && <button type="button" className="participant-action" onClick={() => onToggleStage(p.peerId, !p.onStage)}>{p.onStage ? 'Move to audience' : 'Invite to stage'}</button>}
                {canStartPrivateConversation && !p.isLocal && onStartPrivateConversation && <button type="button" className="participant-action participant-private-action" disabled={privateConversationStatus !== 'idle'} onClick={() => onStartPrivateConversation(p.peerId)}>
                    {privateConversationStatus === 'active' && isPrivateConversationPeer ? 'In conversation' : privateConversationStatus === 'outgoing' && isPrivateConversationPeer ? 'Invite sent' : `Talk privately · ${privateConversationLimitLabel}`}
                </button>}
                {manageable && onSpotlight && (!webinar || isOnStage(p)) && <button type="button" className="participant-icon-action" aria-label={spotlightId === p.peerId ? `Remove spotlight from ${p.displayName}` : `Spotlight ${p.displayName} for everyone`} title={spotlightId === p.peerId ? 'Remove spotlight' : 'Spotlight for everyone'} aria-pressed={spotlightId === p.peerId} onClick={() => onSpotlight(spotlightId === p.peerId ? null : p.peerId)}><span className="mi mi-sm" aria-hidden="true">star</span></button>}
                {manageable && myRole === 'host' && (
                    <button type="button" className="participant-action" title={p.role === 'co-host' ? 'Remove co-host' : 'Make co-host'} onClick={() => void handleChangeRole(p.peerId, p.role === 'co-host' ? 'member' : 'co-host')}>
                        {p.role === 'co-host' ? 'Remove co-host' : 'Make co-host'}
                    </button>
                )}
                {manageable && (
                    <button type="button" className="participant-icon-action host-danger" aria-label={`Remove ${p.displayName}`} title="Remove from meeting" onClick={() => void handleKickPeer(p.peerId, p.displayName)}>
                        <span className="mi mi-sm" aria-hidden="true">person_remove</span>
                    </button>
                )}
            </div>
        </div>;
    };

    return (
        <div className="side-panel participants-panel">
            <div className="panel-header">
                <h3>{webinar ? 'People' : 'Participants'} ({all.length})</h3>
                <button className="panel-close" aria-label="Close participants" onClick={onClose}>
                    <span className="mi mi-sm">close</span>
                </button>
            </div>

            <div className="participants-search">
                <input
                    type="text"
                    aria-label="Search participants" placeholder="Search participants…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="participants-search-input"
                />
            </div>

            <div className="participants-list">
                {groups.map(([title, rows]) => <section key={title} aria-label={title}>
                    {webinar && <h4 className="participants-group">{title} · {rows.length}</h4>}
                    {rows.length ? rows.map(row) : webinar && <p className="participants-empty">{title === 'Audience' ? 'No one in the audience yet.' : 'No one on stage.'}</p>}
                </section>)}
            </div>
        </div>
    );
}
