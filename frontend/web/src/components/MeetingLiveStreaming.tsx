import SelectionInput from './SelectionInput';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getToken } from '../lib/session';
import type { MeetingComposite } from '../lib/meeting-recorder';
import '../styles/meeting-live-streaming.css';

type Provider = 'youtube' | 'facebook';
type Props = {
    open?: boolean; meetingCode: string; isHost: boolean; connected: boolean; e2eeRequired: boolean;
    createComposite: () => MeetingComposite;
    onNotice: (message: string) => void;
    onStreamingChange: (state: { active: boolean; provider: Provider }) => Promise<void>;
};
const API = import.meta.env.VITE_RECORDING_URL || '';
export function supportedBroadcastMime(): string | undefined {
    if (typeof MediaRecorder === 'undefined') return undefined;
    return ['video/webm;codecs=vp8,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
}

/** The host explicitly authorizes decoded meeting media to leave for the chosen public platform. */
export default function MeetingLiveStreaming({ open = true, meetingCode, isHost, connected, e2eeRequired, createComposite, onNotice, onStreamingChange }: Props) {
    const [providers, setProviders] = useState<Provider[]>([]);
    const [provider, setProvider] = useState<Provider>('youtube');
    const [configured, setConfigured] = useState(false);
    const [checked, setChecked] = useState(false);
    const [consent, setConsent] = useState(false);
    const [phase, setPhase] = useState<'idle' | 'starting' | 'sending' | 'stopped' | 'error'>('idle');
    const [error, setError] = useState('');
    const resources = useRef<{ socket?: WebSocket; recorder?: MediaRecorder; composite?: MeetingComposite; announced?: Provider; deadline?: number }>({});
    const revision = useRef(0);
    const starting = useRef(false);
    const change = useRef(onStreamingChange); change.current = onStreamingChange;
    const mounted = useRef(true);
    const stop = useCallback((failure?: string) => {
        revision.current++; starting.current = false;
        const current = resources.current; resources.current = {};
        window.clearTimeout(current.deadline);
        if (current.recorder && current.recorder.state !== 'inactive') current.recorder.stop();
        current.composite?.stop();
        if (current.socket) { current.socket.onclose = null; current.socket.onerror = null; current.socket.onmessage = null; current.socket.close(); }
        if (current.announced) void change.current({ active: false, provider: current.announced }).catch(() => {});
        if (mounted.current) { setPhase(failure ? 'error' : 'stopped'); if (failure) setError(failure); }
    }, []);
    useEffect(() => {
        mounted.current = true;
        const leave = () => stop();
        window.addEventListener('pagehide', leave);
        return () => { mounted.current = false; window.removeEventListener('pagehide', leave); stop(); };
    }, [stop]);
    useEffect(() => { if (!isHost || !connected || e2eeRequired) stop(); }, [isHost, connected, e2eeRequired, stop]);
    useEffect(() => {
        setChecked(false); setConfigured(false); setConsent(false);
        if (!isHost || !connected || e2eeRequired) return;
        const controller = new AbortController();
        fetch(`${API}/api/live-streams/${encodeURIComponent(meetingCode)}`, {
            headers: { Authorization: `Bearer ${getToken()}` }, cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        }).then(async response => {
            if (!response.ok) throw new Error();
            const result = await response.json();
            if (controller.signal.aborted) return;
            const choices = Array.isArray(result.providers) ? result.providers.filter((value: string) => value === 'youtube' || value === 'facebook') : [];
            setProviders(choices); if (choices.length) setProvider(choices[0]);
            setConfigured(result.encoderAvailable === true && choices.length > 0); setChecked(true);
        }).catch(() => { if (!controller.signal.aborted) setChecked(true); });
        return () => controller.abort();
    }, [meetingCode, isHost, connected, e2eeRequired]);
    async function start() {
        if (starting.current || phase === 'starting' || phase === 'sending' || !consent || !configured || !isHost || !connected || e2eeRequired) return;
        const mimeType = supportedBroadcastMime();
        if (!mimeType) { setError('This browser cannot broadcast WebM video. Use a supported desktop browser.'); return; }
        starting.current = true;
        const currentRevision = ++revision.current;
        setPhase('starting'); setError('');
        const active = () => mounted.current && revision.current === currentRevision;
        try {
            // Await the authorized room-wide indicator before any external media can be sent.
            resources.current.announced = provider;
            await change.current({ active: true, provider });
            if (!active()) { void change.current({ active: false, provider }).catch(() => {}); return; }
            resources.current.deadline = window.setTimeout(() => { if (active()) stop('The broadcast did not start in time. Check the provider configuration.'); }, 20000);
            const response = await fetch(`${API}/api/live-streams/${encodeURIComponent(meetingCode)}/session`, {
                method: 'POST', headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider, consent: true }), signal: AbortSignal.timeout(8000),
            });
            if (!response.ok) throw new Error('The broadcast could not start. Check host access and the server configuration.');
            const result = await response.json();
            if (!active()) return;
            if (typeof result.ticket !== 'string' || result.socketPath !== '/api/live-streams/socket') throw new Error('Invalid broadcast session.');
            const url = new URL(API || window.location.origin); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
            url.pathname = result.socketPath; url.search = ''; url.hash = '';
            const socket = new WebSocket(url);
            resources.current.socket = socket;
            socket.onopen = () => { if (active()) socket.send(JSON.stringify({ ticket: result.ticket })); else socket.close(); };
            socket.onerror = () => { if (active()) stop('Broadcast connection failed. Your meeting continues.'); };
            socket.onclose = () => { if (active()) stop('Broadcast connection closed. Check the provider dashboard before restarting.'); };
            socket.onmessage = event => {
                if (!active()) return;
                try {
                    const message = JSON.parse(event.data);
                    if (message.status === 'error' || message.status === 'stopped') { stop('Broadcast stopped. Check the provider dashboard.'); return; }
                    if (message.status === 'sending') { window.clearTimeout(resources.current.deadline); setPhase('sending'); return; }
                    if (message.status !== 'ready' || resources.current.recorder) return;
                    const composite = createComposite(); resources.current.composite = composite;
                    const recorder = new MediaRecorder(composite.stream, { mimeType, videoBitsPerSecond: 1600000, audioBitsPerSecond: 128000 });
                    resources.current.recorder = recorder;
                    recorder.ondataavailable = data => {
                        if (!active() || !data.data.size || socket.readyState !== WebSocket.OPEN) return;
                        if (data.data.size > 2 * 1024 * 1024 || socket.bufferedAmount + data.data.size > 4 * 1024 * 1024) { stop('Broadcast connection cannot keep up. Try again on a faster connection.'); return; }
                        socket.send(data.data);
                    };
                    recorder.onerror = () => stop('The browser stopped encoding the broadcast.');
                    recorder.onstop = () => { if (active()) stop(); };
                    recorder.start(1000);
                } catch { stop('The broadcast could not continue. Your meeting continues.'); }
            };
        } catch (cause) { if (active()) stop(cause instanceof Error ? cause.message : 'Broadcast unavailable.'); }
        finally { if (active()) starting.current = false; }
    }
    if (!isHost || !open) return null;
    const running = phase === 'starting' || phase === 'sending';
    return <section className="meeting-live-streaming" aria-labelledby="live-streaming-title">
        <h3 id="live-streaming-title">Broadcast meeting</h3>
        <p>Send this meeting’s visible video tiles and audio to your administrator’s configured YouTube or Facebook destination. This is a separate decoded-media output.</p>
        {e2eeRequired ? <p role="status">Broadcasting is blocked while this meeting requires end-to-end encryption.</p> : !checked ? <p role="status">Checking broadcast configuration…</p> : !configured ? <p role="status">The server needs FFmpeg and an administrator-configured broadcast destination.</p> : <>
            <label htmlFor="meeting-live-provider">Destination<select id="meeting-live-provider" value={provider} disabled={running} onChange={event => { setProvider(event.target.value as Provider); setConsent(false); }}>{providers.map(value => <option key={value} value={value}>{value === 'youtube' ? 'YouTube' : 'Facebook'}</option>)}</select></label>
            <label className="meeting-live-consent"><SelectionInput type="checkbox" checked={consent} disabled={running} onChange={event => setConsent(event.target.checked)} />I have informed participants and authorize sending meeting audio and video to this external provider.</label>
            <button type="button" disabled={!connected || !consent || running} onClick={() => { void start(); }}>Start broadcast output</button>
        </>}
        {running && <button type="button" className="meeting-live-stop" onClick={() => { stop(); onNotice('Broadcast output stopped. Check the provider dashboard to confirm its public status.'); }}>Stop broadcast output</button>}
        <p role="status">{phase === 'starting' ? 'Starting encoder connection…' : phase === 'sending' ? 'Sending media to the provider. Confirm public visibility in its live dashboard.' : phase === 'stopped' ? 'Broadcast output stopped.' : ''}</p>
        {error && <p role="alert">{error}</p>}
        <p>The provider may require a separate Go live action. Closing or leaving this meeting stops this browser’s broadcast output.</p>
    </section>;
}
