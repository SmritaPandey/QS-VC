import { useCallback, useEffect, useRef, useState } from 'react';
import { getToken } from '../lib/session';
import '../styles/admin-meeting-controls.css';

type Participant = { id: string; displayName: string; role: string; audioMuted: boolean; videoOff: boolean };
type LiveRoom = { id: string; meetingCode: string; startedAt: string; participants: Participant[]; bridgeAvailable?: boolean; externalConference?: { status: string } | null };
type Device = { id: string; name: string; extension: string; protocol: string; enabled: boolean };
type DeviceCall = { callId: string; displayName: string; protocol: string; encrypted?: boolean };
function signalingApi() {
    const configured = import.meta.env.VITE_SIGNALING_URL;
    if (!configured) return '';
    const url = new URL(configured, window.location.origin);
    url.protocol = url.protocol === 'wss:' ? 'https:' : url.protocol === 'ws:' ? 'http:' : url.protocol;
    return url.origin;
}
const failureMessage = (status: number) => status === 401 ? 'Your session expired. Sign in again.' : status === 403 ? 'Platform administrator access is required.' : status === 404 ? 'This participant has left. Refresh the live rooms.' : 'The live room service is unavailable. Please retry.';

function ConferenceDevices({ room, refreshRooms }: { room: LiveRoom; refreshRooms: () => Promise<void> }) {
    const [directory, setDirectory] = useState<Device[]>([]);
    const [calls, setCalls] = useState<{ lobby: DeviceCall[]; roster: DeviceCall[] }>();
    const [device, setDevice] = useState('');
    const [loading, setLoading] = useState(false);
    const [pending, setPending] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const endpoint = `${signalingApi()}/api/admin/rooms/${encodeURIComponent(room.id)}/devices`;
    async function refreshDevices() {
        setLoading(true);
        setError('');
        const headers = { Authorization: `Bearer ${getToken()}` };
        try {
            const [list, status] = await Promise.allSettled([
                fetch(`${import.meta.env.VITE_MEETING_URL || import.meta.env.VITE_API_URL || ''}/api/meetings/admin/room-devices`, { headers, cache: 'no-store', signal: AbortSignal.timeout(8000) }),
                fetch(endpoint, { headers, cache: 'no-store', signal: AbortSignal.timeout(8000) }),
            ]);
            if (list.status === 'fulfilled' && list.value.ok) setDirectory((await list.value.json()).devices);
            else { setDirectory([]); setError('The room device directory is unavailable.'); }
            if (status.status === 'fulfilled' && status.value.ok) setCalls(await status.value.json());
            else setCalls(undefined);
        } catch { setError('Could not refresh room devices.'); }
        finally { setLoading(false); }
    }
    async function act(body: Record<string, unknown>, success: string, form?: HTMLFormElement) {
        if (pending) return;
        setPending(true); setError(''); setMessage('');
        try {
            const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
            if (!response.ok) {
                const data = await response.json().catch(() => null);
                throw new Error(data?.error || 'The conference action could not be confirmed. Refresh before retrying.');
            }
            form?.reset();
            setMessage(success);
            await Promise.all([refreshDevices(), refreshRooms()]);
        } catch (failure) { setError(failure instanceof Error ? failure.message : 'The conference action failed.'); }
        finally { setPending(false); }
    }
    const eligible = directory.filter(entry => entry.enabled && entry.protocol === 'sip');
    if (!room.bridgeAvailable && !room.externalConference) return null;
    return <details className="conference-devices" onToggle={event => { if (event.currentTarget.open && room.bridgeAvailable) void refreshDevices(); }}>
        <summary>Polycom and Bharat VC</summary>
        <p>Use an interoperability meeting for room devices. The gateway requires SIP over TLS and SRTP for outbound calls and can access call media.</p>
        {room.bridgeAvailable && <>
            <div className="conference-device-row">
                <button type="button" disabled={loading || pending} onClick={() => void act({ action: 'start' }, 'Room device bridge enabled.')}>Enable room devices</button>
                <span>Room alias <code>{room.id}</code></span>
            </div>
            <div className="conference-device-row">
                <label>Registered SIP device<select value={device} onChange={event => setDevice(event.target.value)} disabled={loading || pending}>
                    <option value="">Choose a device</option>
                    {eligible.map(entry => <option key={entry.id} value={entry.id}>{entry.name} · {entry.extension}</option>)}
                </select></label>
                <button type="button" disabled={loading || pending || !eligible.some(entry => entry.id === device)} onClick={() => void act({ action: 'dial', deviceId: device }, 'The gateway confirmed the SIP call. Refresh for room status.')}>Dial device</button>
                <button type="button" disabled={loading || pending} onClick={() => void refreshDevices()}>Refresh device status</button>
            </div>
            {!loading && !eligible.length && <p>No eligible SIP devices in your organisation’s directory.</p>}
            {!loading && !calls && <p>Live gateway status is unavailable.</p>}
            {calls && <><h3>Connected room devices</h3>{calls.roster.length ? <ul>{calls.roster.map(call => <li key={call.callId}>{call.displayName} · {call.protocol}{call.encrypted ? ' · encrypted' : ''}</li>)}</ul> : <p>No connected room devices.</p>}
                {calls.lobby.length > 0 && <><h3>Device waiting room</h3><ul>{calls.lobby.map(call => <li key={call.callId}>{call.displayName} · {call.protocol}<div className="admin-media-actions">
                    <button type="button" disabled={pending} onClick={() => void act({ action: 'lobby', callId: call.callId, decision: 'admit' }, 'Device admitted.')}>Admit</button>
                    <button type="button" disabled={pending} onClick={() => void act({ action: 'lobby', callId: call.callId, decision: 'deny' }, 'Device declined.')}>Decline</button>
                </div></li>)}</ul></>}</>}
        </>}
        {room.externalConference ? <div className="conference-device-row"><p>Bharat VC · {room.externalConference.status}</p>
            <button type="button" disabled={pending} onClick={() => void act({ action: 'bharat-disconnect' }, 'Bharat VC disconnected.')}>Disconnect Bharat VC</button></div>
            : room.bridgeAvailable && <form className="conference-device-form" onSubmit={event => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);
                void act({ action: 'bharat-connect', invitation: {
                    conferenceId: data.get('conferenceId'), gateway: data.get('gateway'), pin: data.get('pin'), consent: data.get('consent') === 'on',
                } }, 'Bharat VC connection confirmed by the gateway.', form);
            }}>
                <h3>Connect Bharat VC</h3>
                <div className="conference-device-row">
                    <label>Conference ID<input name="conferenceId" inputMode="numeric" pattern="[0-9]{6,16}" required /></label>
                    <label>SIP gateway<select name="gateway"><option>sip.bharatvc.nic.in</option><option>bhvc.nic.in</option></select></label>
                    <label>SIP PIN<input name="pin" type="password" autoComplete="off" inputMode="numeric" pattern="[0-9]{4,16}" required /></label>
                </div>
                <label><input name="consent" type="checkbox" required /> I am authorised to share this meeting’s media with the external conference.</label>
                <button type="submit" disabled={pending}>Connect Bharat VC</button>
            </form>}
        {loading && <p role="status">Checking device status…</p>}
        {pending && <p role="status">Applying conference action…</p>}
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
    </details>;
}

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
            if (response.status === 404) throw new Error('Live participant controls are unavailable on this connection server.');
            if (!response.ok) throw new Error(failureMessage(response.status));
            const data = await response.json();
            if (!Array.isArray(data.rooms)) throw new Error('The live room service returned an unexpected response.');
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
        <header><h2 id="live-room-controls-title">Live conferences</h2><button type="button" onClick={() => { setNotice(''); void load(); }} disabled={loading || Boolean(pending)}>Refresh live rooms</button></header>
        <p>Stop a participant’s current meeting microphone or all cameras. Screen sharing and private conversation audio are excluded. Participants choose when to turn their microphone or cameras on again.</p>
        <p>Shows live rooms owned by your organisation on this connection server.</p>
        {loading && <p role="status">Loading live rooms…</p>}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {!loading && !error && rooms.length === 0 && <p role="status">No live rooms found.</p>}
        {rooms.map(room => <details key={room.id}>
            <summary>{room.meetingCode} · {room.participants.length} participants</summary>
            <p>Started {new Date(room.startedAt).toLocaleString()}</p>
            <ul>{room.participants.map(peer => <li key={peer.id}>
                <div><span>{peer.displayName}</span><small>{peer.role} · Microphone {peer.audioMuted ? 'muted' : 'on'} · Camera {peer.videoOff ? 'off' : 'on'}</small></div>
                <div className="admin-media-actions"><button type="button" disabled={loading || Boolean(pending)} onClick={() => { void stopMedia(room, peer, 'audio'); }} aria-label={`Mute meeting microphone for ${peer.displayName}`}>Mute microphone</button><button type="button" disabled={loading || Boolean(pending)} onClick={() => { void stopMedia(room, peer, 'video'); }} aria-label={`Turn off all meeting cameras for ${peer.displayName}`}>Turn off cameras</button></div>
            </li>)}</ul>
            <ConferenceDevices room={room} refreshRooms={load} />
        </details>)}
    </section>;
}
