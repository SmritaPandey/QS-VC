import { useCallback, useEffect, useRef, useState } from 'react';
import { getToken } from '../lib/session';
import '../styles/admin-meeting-controls.css';

type Participant = { id: string; displayName: string; role: string; audioMuted: boolean; videoOff: boolean };
type LiveRoom = { id: string; meetingCode: string; startedAt: string; participants: Participant[] };
function signalingApi() {
    const configured = import.meta.env.VITE_SIGNALING_URL;
    if (!configured) return '';
    const url = new URL(configured, window.location.origin);
    url.protocol = url.protocol === 'wss:' ? 'https:' : url.protocol === 'ws:' ? 'http:' : url.protocol;
    return url.origin;
}
const failureMessage = (status: number) => status === 401 ? 'Your session expired. Sign in again.' : status === 403 ? 'Platform administrator access is required.' : status === 404 ? 'This participant has left. Refresh the live rooms.' : 'The live room service is unavailable. Please retry.';

export default function AdminMeetingControls() {
    const [rooms, setRooms] = useState<LiveRoom[]>([]);
    const [loading, setLoading] = useState(true);
    const [pending, setPending] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const generation = useRef(0);
    const load = useCallback(async () => {
        const current = ++generation.current;
        setLoading(true); setError('');
        try {
            const response = await fetch(`${signalingApi()}/api/admin/rooms`, { headers: { Authorization: `Bearer ${getToken()}` }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
            if (!response.ok) throw new Error(failureMessage(response.status));
            const data = await response.json();
            if (current === generation.current) setRooms(data.rooms);
        } catch (failure) { if (current === generation.current) { setRooms([]); setNotice(''); setError(failure instanceof Error ? failure.message : 'Live rooms could not be loaded.'); } }
        finally { if (current === generation.current) setLoading(false); }
    }, []);
    useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
    async function stopMedia(room: LiveRoom, peer: Participant, kind: 'audio' | 'video') {
        if (pending) return;
        const current = generation.current;
        setPending(`${peer.id}:${kind}`); setError(''); setNotice('');
        try {
            const response = await fetch(`${signalingApi()}/api/admin/rooms/${encodeURIComponent(room.id)}/peers/${encodeURIComponent(peer.id)}/media`, {
                method: 'POST', headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind, muted: true }), signal: AbortSignal.timeout(15000),
            });
            if (!response.ok) throw new Error(response.status === 503 ? 'Some media may not have paused. Refresh the rooms and retry.' : failureMessage(response.status));
            if (current !== generation.current) return;
            setNotice(`${kind === 'audio' ? 'Meeting microphone muted' : 'All meeting cameras turned off'} for ${peer.displayName}.`);
            await load();
        } catch (failure) { if (current === generation.current) setError(failure instanceof Error ? failure.message : 'The media control could not be applied.'); }
        finally { setPending(''); }
    }
    return <section className="admin-meeting-controls" aria-labelledby="live-room-controls-title" aria-busy={loading || Boolean(pending)}>
        <header><h2 id="live-room-controls-title">Live participant controls</h2><button type="button" onClick={() => { setNotice(''); void load(); }} disabled={loading || Boolean(pending)}>Refresh live rooms</button></header>
        <p>Stop a participant’s current meeting microphone or all cameras. Screen sharing and private conversation audio are excluded. Participants choose when to turn their microphone or cameras on again.</p>
        <p>Only live rooms on this connection server appear here.</p>
        {loading && <p role="status">Loading live rooms…</p>}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {!loading && !error && rooms.length === 0 && <p role="status">No live rooms found.</p>}
        {!loading && rooms.map(room => <details key={room.id}>
            <summary>{room.meetingCode} · {room.participants.length} participants</summary>
            <p>Started {new Date(room.startedAt).toLocaleString()}</p>
            <ul>{room.participants.map(peer => <li key={peer.id}>
                <div><span>{peer.displayName}</span><small>{peer.role} · Microphone {peer.audioMuted ? 'muted' : 'on'} · Camera {peer.videoOff ? 'off' : 'on'}</small></div>
                <div className="admin-media-actions"><button type="button" disabled={Boolean(pending)} onClick={() => { void stopMedia(room, peer, 'audio'); }} aria-label={`Mute meeting microphone for ${peer.displayName}`}>Mute microphone</button><button type="button" disabled={Boolean(pending)} onClick={() => { void stopMedia(room, peer, 'video'); }} aria-label={`Turn off all meeting cameras for ${peer.displayName}`}>Turn off cameras</button></div>
            </li>)}</ul>
        </details>)}
    </section>;
}
