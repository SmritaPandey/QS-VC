import { useEffect, useRef, useState } from 'react';
import { signaling } from '../lib/signaling';
import { downloadText } from '../lib/caption-stream';

interface SummaryState { active: boolean; text?: string; saved?: boolean; message?: string }

export default function LiveMeetingSummary({ manager, code, onActiveChange, onSettings, controlsRef }: { manager: boolean; code: string; onActiveChange: (active: boolean) => void; onSettings?: () => void; controlsRef: (node: HTMLDivElement | null) => void }) {
    const [state, setState] = useState<SummaryState>({ active: false });
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        onActiveChange(state.active);
        return () => onActiveChange(false);
    }, [state.active, onActiveChange]);
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        let current = true;
        let revision = 0;
        const refresh = () => {
            const seq = ++revision;
            signaling.request('liveSummaryState').then(result => {
                if (current && seq === revision) setState(result);
            }).catch(() => {});
        };
        const off = signaling.on('liveSummaryChanged', (event: { active: boolean }) => {
            ++revision;
            setState(previous => ({ ...previous, active: event.active }));
            if (manager && open) refresh();
        });
        refresh();
        const interval = open && manager ? window.setInterval(refresh, 10000) : undefined;
        return () => { current = false; off(); window.clearInterval(interval); };
    }, [manager, open, code]);
    useEffect(() => {
        if (open) dialog.current?.showModal();
        else dialog.current?.close();
    }, [open, manager]);
    const toggle = async () => {
        if (busy) return;
        setBusy(true); setError('');
        try {
            setState(await signaling.request(state.active ? 'stopLiveSummary' : 'startLiveSummary'));
        } catch (err) { setError(err instanceof Error ? err.message : 'The summary could not be updated.'); }
        finally { setBusy(false); }
    };
    return <>
        <span className="live-summary-badge" role="status" aria-live="polite">{state.active && 'AI summary on'}</span>

        <>
            <button type="button" className="btn-outline meeting-ai-entry" aria-haspopup="dialog" onClick={() => setOpen(true)}>Captions & AI</button>
            <dialog ref={dialog} className="meeting-ai-dialog" aria-labelledby="live-summary-title" onClose={() => setOpen(false)}>
                <h2 id="live-summary-title">Captions, transcript & AI summary</h2>
                <div ref={controlsRef} />
                {manager ? <>
                <p>Starting AI summary also starts transcript saving and notifies everyone. You can stop saving the transcript separately. Shared captions from that point are sent to the AI provider. Speakers choose whether to share captions. Workspace summaries are saved for 90 days.</p>
                <button type="button" className="btn-outline" onClick={toggle} disabled={busy}>{busy ? 'Updating…' : state.active ? 'Stop summary' : 'Start summary'}</button>

                <p role="status">{error || state.message}</p>
                {state.text && <><p style={{ whiteSpace: 'pre-wrap' }}>{state.text}</p><button type="button" onClick={() => downloadText(code + '-summary.md', state.text!)}>Download summary</button></>}
                </> : <p>A host or co-host with Pro or higher can start AI summary.</p>}
                {onSettings && <button type="button" className="btn-text" onClick={() => { dialog.current?.close(); onSettings(); }}>Captions & language settings</button>}
                <button type="button" className="btn-text" onClick={() => dialog.current?.close()}>Close</button>
            </dialog>
        </>
    </>;
}
