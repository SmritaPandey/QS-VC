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
    allowMicrophone: boolean;
    allowCamera: boolean;
    allowReactions: boolean;
}
interface Participant { peerId: string; displayName: string; role: string; audioMuted?: boolean; videoOff?: boolean; handRaised?: boolean }
interface Props { roomDevicesEnabled?: boolean; role: string; myPeerId: string; participants: Participant[]; settings: RoomHostSettings; onClose: () => void; onEndMeeting?: () => void }

export function canManagePeer(role: string, ownId: string, peer: Participant): boolean {
    return (role === 'host' || role === 'co-host') && peer.peerId !== ownId && peer.role !== 'host' && (role === 'host' || peer.role !== 'co-host');
}

/** Google Meet "Host controls": what everyone else may do, how people get in, and per-person actions. */
const LET_EVERYONE: Array<[keyof RoomHostSettings, string, string]> = [
    ['allowScreenShare', 'Share their screen', 'screen_share'],
    ['allowChat', 'Send chat messages', 'chat'],
    ['allowReactions', 'Send reactions', 'add_reaction'],
    ['allowMicrophone', 'Turn on their microphone', 'mic'],
    ['allowCamera', 'Turn on their camera', 'videocam'],
];

export default function HostMeetingTools({ roomDevicesEnabled, role, myPeerId, participants, settings, onClose, onEndMeeting }: Props) {
    const [roomAlias, setRoomAlias] = useState('');
    const [bridgeBusy, setBridgeBusy] = useState(false);
    const [bridgeError, setBridgeError] = useState('');
    const [waiting, setWaiting] = useState<WaitingPeer[]>([]);
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [confirmation, setConfirmation] = useState<string | null>(null);
    const current = useRef(true);
    const refreshVersion = useRef(0);
    const closeRef = useRef<HTMLButtonElement>(null);
    const isManager = role === 'host' || role === 'co-host';
    const coHostCount = participants.filter(peer => peer.role === 'co-host').length;
    const coHostLimitReached = role === 'host' && coHostCount >= 5;
    const refresh = async () => {
        const version = ++refreshVersion.current;
        try {
            const result = await signaling.request('getWaitingRoom', {});
            if (roomDevicesEnabled) {
                const snapshot = await signaling.request('polySnapshot', {}).catch(() => null);
                if (snapshot) result.waitingPeers = [...(result.waitingPeers || []), ...snapshot.lobby.map((entry: { callId: string; displayName: string }) => ({
                    peerId: `poly:${entry.callId}`, displayName: entry.displayName,
                }))];
            }
            if (current.current && version === refreshVersion.current) { setWaiting(result.waitingPeers || []); setLoading(false); }
        } catch {
            if (current.current && version === refreshVersion.current) { setError('Could not refresh the waiting room. Try again.'); setLoading(false); }
        }
    };
    useEffect(() => {
        current.current = true;
        if (!isManager) return;
        closeRef.current?.focus();
        void refresh();
        const remove = ['waitingRoomPeer', 'waitingRoomUpdated', 'peerLeft', 'newPeer', 'roleChanged'].map(event => signaling.on(event, () => { void refresh(); }));
        const timer = roomDevicesEnabled ? window.setInterval(() => void refresh(), 3000) : undefined;
        return () => { window.clearInterval(timer); current.current = false; refreshVersion.current++; remove.forEach(off => off()); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isManager, roomDevicesEnabled]);
    const run = async (method: string, params: Record<string, unknown> = {}) => {
        if (busy || !isManager) return;
        setBusy(true); setError('');
        try {
            const result = await signaling.request(method, params);
            if (current.current) {
                setConfirmation(null);
                if (method === 'admitAll' && Array.isArray(result.failed) && result.failed.length) {
                    setError(`${result.failed.length} could not be admitted. Try admitting them from the waiting room.`);
                }
                await refresh();
            }
        } catch {
            if (current.current) setError('That change could not be made. Please try again.');
        } finally { if (current.current) setBusy(false); }
    };
    const setSetting = (key: keyof RoomHostSettings, value: boolean) => run(key === 'locked' ? 'lockMeeting' : 'updateSettings', key === 'locked' ? { locked: value } : { settings: { [key]: value } });
    if (!isManager) return null;
    const others = participants.filter(peer => peer.peerId !== myPeerId);
    const raisedHands = participants.filter(peer => peer.handRaised).length;
    const toggle = (key: string, label: string, icon: string, checked: boolean, onChange: (value: boolean) => void, hint?: string) =>
        <label key={key} className="host-switch"><span className="mi" aria-hidden="true">{icon}</span><span className="host-switch-text"><span>{label}</span>{hint && <small>{hint}</small>}</span>
            <input type="checkbox" role="switch" checked={checked} disabled={busy} onChange={event => { void onChange(event.target.checked); }} /></label>;

    return <aside className="side-panel host-meeting-tools" id="meeting-host-tools" aria-label="Host controls" onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
        <div className="panel-header"><div><h2>Host controls</h2><p>{role === 'host' ? 'You are the host.' : 'You are a co-host.'} These apply to everyone else.</p></div><button type="button" ref={closeRef} className="panel-close" aria-label="Close host controls" onClick={onClose}><span className="mi" aria-hidden="true">close</span></button></div>
        <div className="host-tools-content" aria-busy={busy}>
            {error && <p className="host-tools-error" role="alert">{error}</p>}
            {loading && <p role="status">Checking who is waiting…</p>}
            <WaitingRoom isHost waitingPeers={waiting} busy={busy || loading} onAdmit={targetPeerId => { void run('admitPeer', { targetPeerId }); }} onKeepWaiting={targetPeerId => { void run('keepWaiting', { targetPeerId }); }} onReject={targetPeerId => { void run('rejectPeer', { targetPeerId }); }} onAdmitAll={() => { void run('admitAll'); }} />

            {roomDevicesEnabled && role === 'host' && <section className="host-tools-settings" aria-labelledby="host-room-devices">
                <h3 id="host-room-devices">Room devices</h3>
                {roomAlias ? <p role="status">Room devices can join using <code>{roomAlias}</code>. Admit callers from the waiting room.</p>
                    : <button type="button" disabled={bridgeBusy || settings.locked} onClick={async () => {
                        setBridgeBusy(true);
                        setBridgeError('');
                        try {
                            const result = await signaling.request('startPolyRoom', {});
                            if (current.current) setRoomAlias(result.roomAlias);
                        } catch {
                            if (current.current) setBridgeError('Room devices could not be enabled. Try again.');
                        } finally { if (current.current) setBridgeBusy(false); }
                    }}>{bridgeBusy ? 'Enabling room devices…' : 'Enable room devices'}</button>}
                {bridgeError && <p role="alert">{bridgeError}</p>}
            </section>}
            <section className="host-tools-settings" aria-labelledby="host-access-title">
                <h3 id="host-access-title">Meeting access</h3>
                <p className="host-access-policy"><span className="mi mi-sm" aria-hidden="true">hourglass_top</span> Everyone waits for host or co-host approval before entering.</p>
                {toggle('locked', 'Lock meeting', 'lock', settings.locked, value => setSetting('locked', value), 'No one new can join.')}
                {toggle('muteOnEntry', 'Mute people when they join', 'mic_off', settings.muteOnEntry, value => setSetting('muteOnEntry', value))}
            </section>

            <section className="host-tools-settings" aria-labelledby="host-let-title">
                <h3 id="host-let-title">Let everyone</h3>
                {LET_EVERYONE.map(([key, label, icon]) => toggle(key, label, icon, settings[key] !== false, value => setSetting(key, value)))}
            </section>

            <section aria-labelledby="host-people-title">
                <div className="host-tools-row"><h3 id="host-people-title">In the meeting ({participants.length})</h3></div>
                {role === 'host' && <p className="host-cohost-count">Co-hosts: {coHostCount} of 5</p>}
                {coHostLimitReached && <p id="host-cohost-limit" className="host-cohost-limit" role="status">All five co-host seats are in use. Remove a co-host before promoting another participant.</p>}
                <div className="host-tools-bulk">
                    <button type="button" disabled={busy || others.length === 0} onClick={() => { void run('muteAll', { kind: 'audio' }); }}><span className="mi mi-sm" aria-hidden="true">mic_off</span>Mute all</button>
                    <button type="button" disabled={busy || raisedHands === 0} onClick={() => { void run('lowerHand', {}); }}><span className="mi mi-sm" aria-hidden="true">back_hand</span>Lower all hands{raisedHands ? ` (${raisedHands})` : ''}</button>
                </div>
                <ul className="host-tools-people">{participants.map(peer => <li key={peer.peerId}>
                    <div className="host-person">
                        <span className="host-avatar" aria-hidden="true">{peer.displayName.trim().charAt(0).toUpperCase() || '?'}</span>
                        <span className="host-person-name"><span>{peer.displayName}{peer.peerId === myPeerId ? ' (You)' : ''}</span><small>{peer.role === 'host' ? 'Host' : peer.role === 'co-host' ? 'Co-host' : 'Participant'}{peer.handRaised ? ' · Hand raised' : ''}</small></span>
                    </div>
                    {canManagePeer(role, myPeerId, peer) && <div className="host-tools-actions">
                        <button type="button" className="host-icon-btn" disabled={busy || peer.audioMuted} aria-label={peer.audioMuted ? `${peer.displayName} is muted` : `Mute ${peer.displayName}`} title={peer.audioMuted ? 'Muted' : 'Mute'} onClick={() => { void run('hostMutePeer', { targetPeerId: peer.peerId, kind: 'audio' }); }}><span className="mi mi-sm" aria-hidden="true">{peer.audioMuted ? 'mic_off' : 'mic'}</span></button>
                        <button type="button" className="host-icon-btn" disabled={busy || peer.videoOff} aria-label={peer.videoOff ? `${peer.displayName}'s camera is off` : `Turn off ${peer.displayName}'s camera`} title={peer.videoOff ? 'Camera off' : 'Turn off camera'} onClick={() => { void run('hostMutePeer', { targetPeerId: peer.peerId, kind: 'video' }); }}><span className="mi mi-sm" aria-hidden="true">{peer.videoOff ? 'videocam_off' : 'videocam'}</span></button>
                        {peer.handRaised && <button type="button" className="host-icon-btn" disabled={busy} aria-label={`Lower ${peer.displayName}'s hand`} title="Lower hand" onClick={() => { void run('lowerHand', { targetPeerId: peer.peerId }); }}><span className="mi mi-sm" aria-hidden="true">back_hand</span></button>}
                        {role === 'host' && <button type="button" className="host-text-btn" disabled={busy || (peer.role !== 'co-host' && coHostLimitReached)} aria-describedby={peer.role !== 'co-host' && coHostLimitReached ? 'host-cohost-limit' : undefined} title={peer.role !== 'co-host' && coHostLimitReached ? 'The meeting can have no more than five co-hosts.' : undefined} onClick={() => { void run('changeRole', { targetPeerId: peer.peerId, newRole: peer.role === 'co-host' ? 'member' : 'co-host' }); }}>{peer.role === 'co-host' ? 'Remove co-host' : 'Make co-host'}</button>}
                        <button type="button" className="host-text-btn host-danger" disabled={busy} onClick={() => setConfirmation(peer.peerId)}>Remove</button>
                    </div>}
                    {confirmation === peer.peerId && <div className="host-tools-confirm"><p>Remove {peer.displayName} from this meeting?</p><button type="button" disabled={busy} onClick={() => { void run('kickPeer', { targetPeerId: peer.peerId }); }}>Remove</button><button type="button" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button></div>}
                </li>)}</ul>
            </section>
            {role === 'host' && <div className="host-tools-end"><button type="button" disabled={busy} onClick={() => onEndMeeting?.()}><span className="mi mi-sm" aria-hidden="true">call_end</span>End meeting for everyone</button></div>}
        </div>
    </aside>;
}
