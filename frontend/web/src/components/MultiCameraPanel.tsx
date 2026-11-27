import { useEffect, useRef, useState } from 'react';
import type { AdditionalCamera, CameraSource } from '../lib/media';
import '../styles/multi-camera.css';

export default function MultiCameraPanel({ open, onClose, primaryDeviceId, cameras, canStart, onStart, onStop }: {
    open: boolean; onClose: () => void; primaryDeviceId?: string; cameras: AdditionalCamera[]; canStart: boolean;
    onStart: (deviceId: string) => Promise<void>; onStop: (source: CameraSource) => Promise<void>;
}) {
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    const [selected, setSelected] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const closeRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!open) return;
        const opener = document.activeElement as HTMLElement | null;
        closeRef.current?.focus();
        return () => {
            if (opener?.isConnected && opener !== document.body) opener.focus();
            else document.querySelector<HTMLButtonElement>('.meeting-room [aria-controls="meeting-more-controls"]')?.focus();
        };
    }, [open]);
    useEffect(() => {
        if (!open) return;
        let active = true;
        const refresh = async () => {
            try {
                const all = await navigator.mediaDevices.enumerateDevices();
                if (active) setDevices(all.filter(device => device.kind === 'videoinput' && device.deviceId));
            } catch { if (active) setMessage('Camera devices could not be listed. Check browser permissions.'); }
        };
        void refresh();
        navigator.mediaDevices?.addEventListener('devicechange', refresh);
        return () => { active = false; navigator.mediaDevices?.removeEventListener('devicechange', refresh); };
    }, [open, cameras.length]);
    if (!open) return null;
    const used = new Set([primaryDeviceId, ...cameras.map(camera => camera.deviceId)]);
    const available = devices.filter(device => !used.has(device.deviceId));
    const chosen = available.some(device => device.deviceId === selected) ? selected : available[0]?.deviceId || '';
    async function action(work: () => Promise<void>) {
        setBusy(true); setMessage('');
        try { await work(); }
        catch (error) { setMessage(error instanceof Error ? error.message : 'Camera could not be changed. Try again.'); }
        finally { setBusy(false); }
    }
    return <section className="multi-camera-panel" aria-labelledby="multi-camera-title" onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
        <header><h2 id="multi-camera-title">Your cameras</h2><button ref={closeRef} type="button" aria-label="Close camera settings" onClick={onClose}><span className="mi" aria-hidden="true">close</span></button></header>
        <p>Use up to four different cameras at once, including your main camera. Extra cameras have no microphone audio.</p>
        <p>Starting a camera asks for browser permission. All cameras stop when you leave this tab; restart them when ready.</p>
        <ul className="multi-camera-active"><li><span>Main camera</span><span>{primaryDeviceId ? 'Selected in meeting controls' : 'Choose in meeting controls'}</span></li>
            {cameras.map(camera => <li key={camera.source}><span>{devices.find(device => device.deviceId === camera.deviceId)?.label || `Camera ${camera.source.slice(-1)}`}</span><button type="button" disabled={busy} onClick={() => void action(() => onStop(camera.source))}>Stop camera {camera.source.slice(-1)}</button></li>)}
        </ul>
        <label htmlFor="extra-camera-device">Additional camera<select id="extra-camera-device" value={chosen} disabled={busy || !canStart || cameras.length >= 3} onChange={event => setSelected(event.target.value)}>
            {!available.length && <option value="">No unused camera found</option>}
            {available.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera device ${index + 1}`}</option>)}
        </select></label>
        <button className="multi-camera-start" type="button" disabled={busy || !canStart || !chosen || cameras.length >= 3} onClick={() => void action(() => onStart(chosen))}>{busy ? 'Updating camera…' : 'Start additional camera'}</button>
        {!canStart && <p>Turn on your main camera first. If camera access is restricted, ask the host to allow it.</p>}
        {cameras.length >= 3 && <p>All four camera slots are in use. Stop an extra camera to choose another.</p>}
        {message && <p role="alert">{message}</p>}
    </section>;
}
