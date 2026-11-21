import { useEffect, useRef, useState } from 'react';
import { signaling } from '../lib/signaling';
import { downloadText } from '../lib/caption-stream';

interface SummaryState { active: boolean; text?: string; saved?: boolean; message?: string }

export default function LiveMeetingSummary({ manager, code }: { manager: boolean; code: string }) {
    const [state, setState] = useState<SummaryState>({ active: false });
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
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
        if (open && manager) dialog.current?.showModal();
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
        <span role="status" aria-live="polite">{state.active && 'AI summary is on · using shared captions'}</span>
        {manager && <>
            <button type="button" className="btn-outline" aria-haspopup="dialog" onClick={() => setOpen(true)}>AI summary</button>
            <dialog ref={dialog} aria-labelledby="live-summary-title" onClose={() => setOpen(false)} style={{ maxWidth: 'min(32rem, 94vw)', maxHeight: '80dvh', overflow: 'auto' }}>
                <h2 id="live-summary-title">AI meeting summary</h2>
                <p>Everyone is notified when you start. Shared captions from that point are sent to the AI provider. Speakers choose whether to share captions. Workspace summaries are saved for 90 days.</p>
                <button type="button" className="btn-outline" onClick={toggle} disabled={busy}>{busy ? 'Updating…' : state.active ? 'Stop summary' : 'Start summary'}</button>
                <button type="button" className="btn-text" onClick={() => dialog.current?.close()}>Close</button>
                <p role="status">{error || state.message}</p>
                {state.text && <><p style={{ whiteSpace: 'pre-wrap' }}>{state.text}</p><button type="button" onClick={() => downloadText(code + '-summary.md', state.text!)}>Download summary</button></>}
            </dialog>
        </>}
    </>;
}
