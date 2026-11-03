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

export function WaitingAdmission({ meetingCode, onLeave }: { meetingCode: string; onLeave: () => void }) {
    return <main className="waiting-admission"><div><span className="mi" aria-hidden="true">meeting_room</span><h1>Waiting to be let in</h1><p role="status">The host will let you into {meetingCode} shortly.</p><p>Your camera and microphone are off while you wait.</p><button type="button" onClick={onLeave}>Leave waiting room</button></div></main>;
}
