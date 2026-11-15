import { useEffect, useId, useRef, useState } from 'react';
import { AUTH_API } from '../lib/session';
import ActionContents from './ActionContents';
import '../styles/download-leads.css';

/** Contact details are sent only by the explicit follow-up action; skipping sends nothing. */
export default function DownloadLeadStep({ platform, onContinue, onCancel }: {
    platform: string; onContinue: () => void; onCancel: () => void;
}) {
    const id = useId();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const request = useRef<AbortController | null>(null);
    const firstInput = useRef<HTMLInputElement>(null);
    useEffect(() => { firstInput.current?.focus(); return () => request.current?.abort(); }, []);
    async function submit(event: React.FormEvent) {
        event.preventDefault();
        if (request.current) return;
        const controller = new AbortController();
        request.current = controller;
        setBusy(true); setError('');
        try {
            const response = await fetch(`${AUTH_API}/api/auth/enterprise/download-leads`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name.trim(), email: email.trim(), platform, consent: true }),
                signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
            });
            if (!response.ok) throw new Error();
            if (!controller.signal.aborted) onContinue();
        } catch {
            if (!controller.signal.aborted) setError('Your details could not be saved. Try again, or skip to download.');
        } finally {
            if (!controller.signal.aborted) { setBusy(false); request.current = null; }
        }
    }
    return <form className="download-lead-step" onSubmit={submit} aria-labelledby={`${id}-title`} aria-busy={busy}>
        <h3 id={`${id}-title`}>Would you like help getting started?</h3>
        <p>Optional. Share your details so our sales team can follow up about QS-VC.</p>
        <div className="download-lead-fields">
            <label htmlFor={`${id}-name`}>Name<input ref={firstInput} id={`${id}-name`} autoComplete="name" value={name} onChange={e => setName(e.target.value)} required maxLength={100} disabled={busy} /></label>
            <label htmlFor={`${id}-email`}>Organisation email<input id={`${id}-email`} type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={255} disabled={busy} /></label>
        </div>
        <p id={`${id}-consent`}>By choosing “Share details & download”, you agree to be contacted by our sales team about QS-VC.</p>
        {error && <p role="alert">{error}</p>}
        <div className="download-lead-actions">
            <button className="qsvc-action" type="submit" disabled={busy} aria-describedby={`${id}-consent`}><ActionContents>{busy ? 'Saving details…' : 'Share details & download'}</ActionContents></button>
            <button className="qsvc-action qsvc-action--secondary" type="button" onClick={onContinue} disabled={busy}><ActionContents>Skip & download</ActionContents></button>
            <button className="download-lead-cancel" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
    </form>;
}
