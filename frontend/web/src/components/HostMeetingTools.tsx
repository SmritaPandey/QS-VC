import { useEffect, useRef, useState } from 'react';
import { signaling } from '../lib/signaling';
import WaitingRoom, { type WaitingPeer } from './WaitingRoom';
import '../styles/host-meeting-tools.css';

export interface RoomHostSettings {
    locked: boolean;
    waitingRoomEnabled: boolean;
    muteOnEntry: boolean;
    allowScreenShare: boolean;
    allowChat: boolean;
}
interface Participant { peerId: string; displayName: string; role: string; audioMuted?: boolean }
interface Props { role: string; myPeerId: string; participants: Participant[]; settings: RoomHostSettings; onClose: () => void }

export function canManagePeer(role: string, ownId: string, peer: Participant): boolean {
    return (role === 'host' || role === 'co-host') && peer.peerId !== ownId && peer.role !== 'host' && (role === 'host' || peer.role !== 'co-host');
}

export default function HostMeetingTools({ role, myPeerId, participants, settings, onClose }: Props) {
    const [waiting, setWaiting] = useState<WaitingPeer[]>([]);
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [confirmation, setConfirmation] = useState<string | null>(null);
    const current = useRef(true);
    const refreshVersion = useRef(0);
    const closeRef = useRef<HTMLButtonElement>(null);
    const isManager = role === 'host' || role === 'co-host';
    const refresh = async () => {
        const version = ++refreshVersion.current;
        try {
            const result = await signaling.request('getWaitingRoom', {});
            if (current.current && version === refreshVersion.current) { setWaiting(result.waitingPeers || []); setLoading(false); }
        } catch (reason) {
            if (current.current && version === refreshVersion.current) { setError(reason instanceof Error ? reason.message : 'Could not refresh the waiting room.'); setLoading(false); }
        }
    };
    useEffect(() => {
        current.current = true;
        if (!isManager) return;
        closeRef.current?.focus();
        void refresh();
        const remove = ['waitingRoomPeer', 'waitingRoomUpdated', 'peerLeft', 'roleChanged'].map(event => signaling.on(event, () => { void refresh(); }));
        return () => { current.current = false; refreshVersion.current++; remove.forEach(off => off()); };
    }, [isManager]);
    const run = async (method: string, params: Record<string, unknown> = {}) => {
        if (busy || !isManager) return;
        setBusy(true); setError('');
        try {
            const result = await signaling.request(method, params);
            if (current.current) {
                setConfirmation(null);
                if (method === 'admitAll' && Array.isArray(result.failed) && result.failed.length) {
                    const reasons = [...new Set(result.failed.map((failure: { reason: string }) => failure.reason))].join(' ');
                    setError(`${result.failed.length} could not be admitted and remain in the waiting room. ${reasons}`);
                }
                await refresh();
            }
        } catch (reason) {
            if (current.current) setError(reason instanceof Error ? reason.message : 'That change could not be made. Please try again.');
        } finally { if (current.current) setBusy(false); }
    };
    if (!isManager) return null;
    return <aside className="side-panel host-meeting-tools" id="meeting-host-tools" aria-label="Host controls" onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
        <div className="panel-header"><div><h2>Host controls</h2><p>Manage entry and participation.</p></div><button type="button" ref={closeRef} className="panel-close" aria-label="Close host controls" onClick={onClose}><span className="mi" aria-hidden="true">close</span></button></div>
        <div className="host-tools-content" aria-busy={busy}>
            {error && <p className="host-tools-error" role="alert">{error}</p>}
            {loading && <p role="status">Checking the waiting room…</p>}
            <WaitingRoom isHost waitingPeers={waiting} busy={busy || loading} onAdmit={targetPeerId => { void run('admitPeer', { targetPeerId }); }} onReject={targetPeerId => { void run('rejectPeer', { targetPeerId }); }} onAdmitAll={() => { void run('admitAll'); }} />
            <button type="button" disabled={busy} onClick={() => { setLoading(true); setError(''); void refresh(); }}>Refresh waiting room</button>
            <section className="host-tools-settings" aria-label="Meeting settings">
                <h3>Meeting settings</h3>
                {([['locked', 'Lock meeting'], ['waitingRoomEnabled', 'Waiting room'], ['muteOnEntry', 'Mute on entry'], ['allowScreenShare', 'Allow screen sharing'], ['allowChat', 'Allow chat']] as const).map(([key, label]) => <label key={key}><span>{label}</span><input type="checkbox" checked={settings[key]} disabled={busy} onChange={event => { void run(key === 'locked' ? 'lockMeeting' : 'updateSettings', key === 'locked' ? { locked: event.target.checked } : { settings: { [key]: event.target.checked } }); }} /></label>)}
            </section>
            <section aria-label="Manage participants"><div className="host-tools-row"><h3>Participants</h3><button type="button" disabled={busy} onClick={() => { void run('muteAll', { kind: 'audio' }); }}>Mute all</button></div>
                <ul className="host-tools-people">{participants.map(peer => <li key={peer.peerId}><div><span>{peer.displayName}</span><small>{peer.role}{peer.peerId === myPeerId ? ' · You' : ''}</small></div>{canManagePeer(role, myPeerId, peer) && <div className="host-tools-actions"><button type="button" disabled={busy || peer.audioMuted} aria-label={`Mute ${peer.displayName}`} onClick={() => { void run('hostMutePeer', { targetPeerId: peer.peerId, kind: 'audio' }); }}>{peer.audioMuted ? 'Muted' : 'Mute'}</button>{role === 'host' && <select aria-label={`Role for ${peer.displayName}`} value={peer.role} disabled={busy} onChange={event => { void run('changeRole', { targetPeerId: peer.peerId, newRole: event.target.value }); }}><option value="co-host">Co-host</option><option value="member">Member</option><option value="guest">Guest</option></select>}<button type="button" disabled={busy} onClick={() => setConfirmation(peer.peerId)}>Remove</button></div>}{confirmation === peer.peerId && <div className="host-tools-confirm"><p>Remove {peer.displayName} from this meeting?</p><button type="button" disabled={busy} onClick={() => { void run('kickPeer', { targetPeerId: peer.peerId }); }}>Remove participant</button><button type="button" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button></div>}</li>)}</ul>
            </section>
            {role === 'host' && <div className="host-tools-end">{confirmation === 'end-meeting' ? <><p>End this meeting for everyone?</p><button type="button" disabled={busy} onClick={() => { void run('endMeeting'); }}>End for everyone</button><button type="button" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button></> : <button type="button" disabled={busy} onClick={() => setConfirmation('end-meeting')}>End meeting for everyone</button>}</div>}
        </div>
    </aside>;
}
