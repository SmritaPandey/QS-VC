export interface WaitingPeer { peerId: string; displayName: string; requestedAt?: string; invited?: boolean; reviewed?: boolean; isGuest?: boolean; }
interface Props {
    waitingPeers: WaitingPeer[];
    onAdmit: (peerId: string) => void;
    onKeepWaiting: (peerId: string) => void;
    onReject: (peerId: string) => void;
    onAdmitAll: () => void;
    isHost: boolean;
    busy?: boolean;
}
export default function WaitingRoom({ waitingPeers, onAdmit, onKeepWaiting, onReject, onAdmitAll, isHost, busy = false }: Props) {
    if (!isHost) return null;
    return <section className="host-waiting" aria-labelledby="host-waiting-title" aria-live="polite">
        <div className="host-tools-row"><h3 id="host-waiting-title">Waiting to join ({waitingPeers.length})</h3>{waitingPeers.length > 1 && <button type="button" disabled={busy} onClick={onAdmitAll}>Admit all</button>}</div>
        {waitingPeers.length === 0 ? <p>No one is waiting.</p> : <ul>{waitingPeers.map(peer => <li key={peer.peerId}>
            <div className="host-waiting-person">
                <span>{peer.displayName}</span>
                <span className={peer.isGuest ? 'host-guest-label' : 'host-member-label'}>{peer.isGuest ? 'Guest' : 'Member'}</span>
                {peer.invited && <span className="host-invited-label">Invited</span>}
                {peer.reviewed && <span className="host-reviewed-label" role="status">Still waiting · remains in this queue</span>}
            </div>
            <div className="host-tools-actions">
                <button type="button" disabled={busy} aria-label={`Admit ${peer.displayName} to the meeting`} onClick={() => onAdmit(peer.peerId)}>Admit to meeting</button>
                <button type="button" disabled={busy || peer.reviewed} aria-label={peer.reviewed ? `${peer.displayName} is already kept waiting in this queue` : `Keep ${peer.displayName} waiting in this queue`} onClick={() => onKeepWaiting(peer.peerId)}>{peer.reviewed ? 'Kept waiting' : 'Keep waiting'}</button>
                <button type="button" disabled={busy} aria-label={`Decline ${peer.displayName}`} onClick={() => onReject(peer.peerId)}>Decline</button>
            </div>
        </li>)}</ul>}
    </section>;
}

export type WaitingMode = 'host' | 'knock' | 'seen';

/** Shown before admission: waiting for the host to start (Google Meet style), or asking to be let in. */
export function WaitingAdmission({ meetingCode, onLeave, mode = 'knock' }: { meetingCode: string; onLeave: () => void; mode?: WaitingMode }) {
    const forHost = mode === 'host';
    const reviewed = mode === 'seen';
    return <main className="waiting-admission"><div>
        <span className="mi waiting-admission-icon" aria-hidden="true">{forHost ? 'hourglass_top' : reviewed ? 'mark_chat_read' : 'front_hand'}</span>
        <h1>{forHost ? 'Waiting for the host' : reviewed ? 'Your request has been seen' : 'Asking to join…'}</h1>
        <p role="status" aria-live="polite">{forHost
            ? `The meeting ${meetingCode} hasn’t started yet. You’ll be moved to the waiting room once the host arrives.`
            : reviewed ? `A host or co-host has seen your request. You’re still in the waiting room for ${meetingCode}; they can admit or decline you.` : `Your request to join ${meetingCode} is in the waiting room until a host or co-host admits you.`}</p>
        <p className="waiting-admission-note">Keep this page open. Your camera and microphone stay off until you’re in.</p>
        <span className="waiting-admission-dots" aria-hidden="true"><i /><i /><i /></span>
        <button type="button" onClick={onLeave}>{forHost ? 'Leave' : 'Leave waiting room'}</button>
    </div></main>;
}
