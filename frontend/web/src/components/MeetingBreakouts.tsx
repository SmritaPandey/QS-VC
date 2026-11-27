import SelectionInput from './SelectionInput';
import { useEffect, useRef, useState } from 'react';
import { signaling } from '../lib/signaling';
import '../styles/meeting-breakouts.css';

export interface BreakoutRoom { roomId: string; name: string; open: boolean; assignedPeerIds?: string[] }
export interface BreakoutState { mainRoomId: string; mainMeetingCode: string; rooms: BreakoutRoom[] }
interface Props {
    connected: boolean; isHost: boolean; currentRoomId: string | null; transitioning: boolean;
    participants: Array<{ peerId: string; displayName: string }>;
    onJoin: (roomId: string | null) => Promise<void>; onClose: () => void;
}

export default function MeetingBreakouts({ connected, isHost, currentRoomId, transitioning, participants, onJoin, onClose }: Props) {
    const [snapshot, setSnapshot] = useState<BreakoutState | null>(null);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const inFlight = useRef(false);
    const close = useRef<HTMLButtonElement>(null);
    useEffect(() => { close.current?.focus(); }, []);
    useEffect(() => {
        if (!connected) return;
        let active = true;
        setError('');
        const off = signaling.on('breakoutRoomsUpdated', (value: BreakoutState) => { if (active) setSnapshot(value); });
        signaling.request('getBreakoutRooms', {}).then(value => { if (active) setSnapshot(value); }).catch(() => { if (active) setError('Breakout rooms could not be loaded. Close this panel and try again.'); });
        return () => { active = false; off(); };
    }, [connected, currentRoomId]);
    async function run(method: string, params: object = {}) {
        if (inFlight.current || transitioning || !connected) return;
        inFlight.current = true; setBusy(true); setError('');
        try { setSnapshot(await signaling.request(method, params)); if (method === 'createBreakoutRoom') setName(''); }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'The breakout change could not be saved.'); }
        finally { inFlight.current = false; setBusy(false); }
    }
    async function join(roomId: string | null) {
        if (inFlight.current || transitioning || !connected) return;
        inFlight.current = true; setBusy(true); setError('');
        try { await onJoin(roomId); }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'The room could not be joined. Please try again.'); }
        finally { inFlight.current = false; setBusy(false); }
    }
    const disabled = busy || transitioning || !connected;
    const roomsOpen = snapshot?.rooms.some(room => room.open) || false;
    const inBreakout = !!snapshot && !!currentRoomId && currentRoomId !== snapshot.mainRoomId;
    return <section id="meeting-breakouts" className="side-panel meeting-breakouts" aria-labelledby="meeting-breakouts-title" onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
        <div className="panel-header"><h3 id="meeting-breakouts-title">Breakout rooms</h3><button type="button" ref={close} className="panel-close" aria-label="Close breakout rooms" onClick={onClose}><span className="mi" aria-hidden="true">close</span></button></div>
        <div className="meeting-breakouts-content">
            <p>Move into a smaller conversation, then return to the main meeting. Your screen share stops when you move.</p>
            {error && <p role="alert" className="meeting-breakouts-error">{error}</p>}
            <p role="status">{!connected ? 'Reconnect to manage or join breakout rooms.' : transitioning ? 'Moving rooms and setting up your secure media…' : busy ? 'Updating breakout rooms…' : !snapshot && !error ? 'Loading breakout rooms…' : ''}</p>
            {inBreakout && <button type="button" disabled={disabled} onClick={() => void join(null)}>Return to main meeting</button>}
            {isHost && snapshot && <>
                <form onSubmit={event => { event.preventDefault(); if (name.trim()) void run('createBreakoutRoom', { name: name.trim() }); }}>
                    <label htmlFor="breakout-name">Room name</label><input id="breakout-name" value={name} maxLength={60} disabled={disabled || snapshot.rooms.length >= 20} onChange={event => setName(event.target.value)} />
                    <button type="submit" disabled={disabled || !name.trim() || snapshot.rooms.length >= 20}>Create room</button>
                </form>
                <p>Assign participants while rooms are closed. Each participant can be assigned to one room.</p>
                <button type="button" disabled={disabled || !snapshot.rooms.length} onClick={() => { if (!roomsOpen || window.confirm('Close all breakout rooms and return everyone to the main meeting?')) void run(roomsOpen ? 'closeBreakoutRooms' : 'openBreakoutRooms'); }}>{roomsOpen ? 'Close rooms and bring everyone back' : 'Open rooms'}</button>
            </>}
            {snapshot && !snapshot.rooms.length && <p>{isHost ? 'Create a room to get started.' : 'The host has not assigned you a breakout room.'}</p>}
            {snapshot?.rooms.map(room => <article key={room.roomId} className="meeting-breakout-room">
                <h4>{room.name}</h4><p>{room.open ? 'Open' : 'Closed'}{currentRoomId === room.roomId ? ' · You are here' : ''}</p>
                {isHost && <fieldset disabled={disabled || roomsOpen}><legend>Assign participants to {room.name}</legend>{participants.map(peer => <label key={peer.peerId}><SelectionInput type="checkbox" checked={room.assignedPeerIds?.includes(peer.peerId) || false} onChange={event => void run('assignBreakoutParticipants', { breakoutRoomId: room.roomId, peerIds: event.target.checked ? [...(room.assignedPeerIds || []), peer.peerId] : (room.assignedPeerIds || []).filter(id => id !== peer.peerId) })} />{peer.displayName}</label>)}</fieldset>}
                {currentRoomId !== room.roomId && <button type="button" disabled={disabled || !room.open} onClick={() => void join(room.roomId)}>Join {room.name}</button>}
            </article>)}
        </div>
    </section>;
}
