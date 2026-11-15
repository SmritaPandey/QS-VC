import { useRef, useState } from 'react';
import '../styles/bharat-vc.css';
import { signaling } from '../lib/signaling';

export default function BharatVcConnection() {
    const [conferenceId, setId] = useState('');
    const [gateway, setGateway] = useState('sip.bharatvc.nic.in');
    const [pin, setPin] = useState('');
    const [consent, setConsent] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const pending = useRef(false);
    return <section className="host-tools-settings bharat-vc-connection" aria-labelledby="bharat-vc-heading">
        <h3 id="bharat-vc-heading">Connect Bharat VC</h3>
        <p>Use the SIP details from your authorised invitation. This sends meeting audio and video to Bharat VC. End-to-end encrypted meetings cannot use this bridge.</p>
        <form onSubmit={async event => {
            event.preventDefault(); if (pending.current || !consent) return;
            pending.current = true; setBusy(true); setMessage('');
            try { await signaling.request('connectBharatVc', { conferenceId, gateway, pin, consent: true }); setPin(''); setMessage('SIP call connected. Confirm two-way audio and video with the Bharat VC organiser.'); }
            catch (failure) { setMessage(failure instanceof Error ? failure.message : 'The connection could not be confirmed.'); }
            finally { pending.current = false; setBusy(false); }
        }}>
            <fieldset disabled={busy} style={{ display: 'grid', gap: 12, border: 0, padding: 0, minWidth: 0 }}>
                <label>Conference ID<input required inputMode="numeric" pattern="[0-9]{6,16}" value={conferenceId} onChange={event => setId(event.target.value)} /></label>
                <label>SIP gateway<select value={gateway} onChange={event => setGateway(event.target.value)}><option>sip.bharatvc.nic.in</option><option>bhvc.nic.in</option></select></label>
                <label>SIP PIN<input required type="password" autoComplete="off" inputMode="numeric" pattern="[0-9]{4,16}" value={pin} onChange={event => setPin(event.target.value)} /></label>
                <label><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />I have informed participants and authorise sharing this meeting with Bharat VC.</label>
                <button type="submit" disabled={!consent}>{busy ? 'Connecting…' : 'Connect conference'}</button>
            </fieldset>
        </form>
        <button type="button" disabled={busy} onClick={async () => {
            if (pending.current) return; pending.current = true; setBusy(true);
            try { await signaling.request('disconnectBharatVc'); setMessage('External SIP call disconnected.'); }
            catch { setMessage('Disconnection could not be confirmed. Ask the administrator to check the bridge.'); }
            finally { pending.current = false; setBusy(false); }
        }}>Disconnect external conference</button>
        {message && <p role="status">{message}</p>}
    </section>;
}
