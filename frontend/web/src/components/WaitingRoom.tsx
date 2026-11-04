export interface WaitingPeer { peerId: string; displayName: string; requestedAt?: string }
interface Props {
    waitingPeers: WaitingPeer[];
    onAdmit: (peerId: string) => void;
    onReject: (peerId: string) => void;
    onAdmitAll: () => void;
    isHost: boolean;
    busy?: boolean;
}
export default function WaitingRoom({ waitingPeers, onAdmit, onReject, onAdmitAll, isHost, busy = false }: Props) {
    if (!isHost) return null;
    return <section className="host-waiting" aria-labelledby="host-waiting-title">
        <div className="host-tools-row"><h3 id="host-waiting-title">Waiting to join ({waitingPeers.length})</h3>{waitingPeers.length > 1 && <button type="button" disabled={busy} onClick={onAdmitAll}>Admit all</button>}</div>
        {waitingPeers.length === 0 ? <p>No one is waiting.</p> : <ul>{waitingPeers.map(peer => <li key={peer.peerId}><span>{peer.displayName}</span><div className="host-tools-actions"><button type="button" disabled={busy} aria-label={`Admit ${peer.displayName}`} onClick={() => onAdmit(peer.peerId)}>Admit</button><button type="button" disabled={busy} aria-label={`Decline ${peer.displayName}`} onClick={() => onReject(peer.peerId)}>Decline</button></div></li>)}</ul>}
    </section>;
}

export type WaitingMode = 'host' | 'knock';

/** Shown before admission: waiting for the host to start (Google Meet style), or asking to be let in. */
export function WaitingAdmission({ meetingCode, onLeave, mode = 'knock' }: { meetingCode: string; onLeave: () => void; mode?: WaitingMode }) {
    const forHost = mode === 'host';
    return <main className="waiting-admission"><div>
        <span className="mi waiting-admission-icon" aria-hidden="true">{forHost ? 'hourglass_top' : 'front_hand'}</span>
        <h1>{forHost ? 'Waiting for the host' : 'Asking to join…'}</h1>
        <p role="status" aria-live="polite">{forHost
            ? `The meeting ${meetingCode} hasn’t started yet. You’ll join automatically as soon as the host arrives.`
            : `Someone in ${meetingCode} will let you in soon.`}</p>
        <p className="waiting-admission-note">Keep this page open. Your camera and microphone stay off until you’re in.</p>
        <span className="waiting-admission-dots" aria-hidden="true"><i /><i /><i /></span>
        <button type="button" onClick={onLeave}>{forHost ? 'Leave' : 'Leave waiting room'}</button>
    </div></main>;
}
