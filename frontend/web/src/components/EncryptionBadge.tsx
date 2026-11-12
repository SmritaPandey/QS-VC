import { useEffect, useId, useRef, useState } from 'react';

interface Props {
    active: boolean;
    securityCode: string | null;
    participants: number;
}

export default function EncryptionBadge({ active, securityCode, participants }: Props) {
    const [open, setOpen] = useState(false);
    const panelId = useId();
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const close = (event: MouseEvent | KeyboardEvent) => {
            if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
        return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
    }, [open]);

    return <div className="qs-e2ee" ref={ref} data-state={active ? 'on' : 'pending'}>
        <button type="button" className="qs-e2ee-chip" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(v => !v)}
            title={active ? 'Quantum-safe end-to-end encryption is on' : 'Setting up end-to-end encryption…'}>
            <span className="mi mi-sm" aria-hidden="true">{active ? 'lock' : 'lock_clock'}</span>
            <span className="qs-e2ee-label">{active ? 'End-to-end encrypted' : 'Encrypting…'}</span>
        </button>
        {open && <div className="qs-e2ee-panel" id={panelId} role="dialog" aria-label="Encryption details">
            <h2><span className="mi" aria-hidden="true">verified_user</span> Quantum-safe end-to-end encryption</h2>
            <p>{active
                ? 'End-to-end encryption protects this meeting’s audio, video and screen sharing. It uses post-quantum algorithms standardised in NIST FIPS 203 and 204.'
                : 'End-to-end encryption is being prepared. Wait for the security code before checking the meeting.'}</p>
            <p>Captions, translations and transcripts can be read by the meeting service. If you allow server transcription, its processor also receives a copy of your microphone audio.</p>
            <dl><div><dt>Participants</dt><dd>{participants}</dd></div></dl>
            <div className="qs-e2ee-code">
                <span>Security code</span>
                <strong aria-live="polite">{securityCode || '…'}</strong>
            </div>
            <p className="qs-e2ee-hint">Compare this code with the other participants. It can change when someone joins or leaves. If the codes differ, pause before sharing anything sensitive.</p>
        </div>}
    </div>;
}
