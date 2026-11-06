import { useEffect, useId, useRef, useState } from 'react';

interface Props {
    active: boolean;
    securityCode: string | null;
    participants: number;
    mode: 'streams' | 'script' | 'none' | null;
}

/**
 * Top-bar status for end-to-end encryption. Opens a small panel with the algorithms in use and the
 * meeting security code participants can compare to rule out key substitution by the server.
 */
export default function EncryptionBadge({ active, securityCode, participants, mode }: Props) {
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
            <p>Audio, video and screen sharing are encrypted on your device and can only be decrypted by people in this meeting. The QS-VC servers forward media they cannot read.</p>
            <dl>
                <div><dt>Key exchange</dt><dd>ML-KEM-1024 (NIST FIPS 203)</dd></div>
                <div><dt>Signatures</dt><dd>ML-DSA-87 (NIST FIPS 204)</dd></div>
                <div><dt>Media</dt><dd>AES-256-GCM per frame, new key whenever someone leaves</dd></div>
                <div><dt>Participants</dt><dd>{participants}</dd></div>
                {mode && mode !== 'none' && <div><dt>Browser engine</dt><dd>{mode === 'streams' ? 'Encoded streams' : 'Script transform (worker)'}</dd></div>}
            </dl>
            <div className="qs-e2ee-code">
                <span>Security code</span>
                <strong aria-live="polite">{securityCode || '…'}</strong>
            </div>
            <p className="qs-e2ee-hint">Compare this code with the others (for example, read it out). If everyone sees the same code, nobody — not even the server — has intercepted the meeting keys. It changes when people join or leave.</p>
        </div>}
    </div>;
}
