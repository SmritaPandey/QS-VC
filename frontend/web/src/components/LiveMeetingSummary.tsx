import { useEffect, useState } from 'react';
import { signaling } from '../lib/signaling';

interface SummaryState {
    active: boolean;
    hasSpeech?: boolean;
    text?: string;
    saved?: boolean;
    message?: string;
}

interface Props {
    manager: boolean;
    code: string;
    onActiveChange: (active: boolean) => void;
    open?: boolean;
    onToggle?: () => void;
}

export default function LiveMeetingSummary({ manager, code, onActiveChange, open = false, onToggle }: Props) {
    const [state, setState] = useState<SummaryState>({ active: false });
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        onActiveChange(state.active);
        return () => onActiveChange(false);
    }, [state.active, onActiveChange]);

    useEffect(() => {
        let current = true;
        let revision = 0;
        const refresh = () => {
            const seq = ++revision;
            signaling.request('liveSummaryState').then(result => {
                if (current && seq === revision) setState(result);
            }).catch(() => {});
        };
        const off = signaling.on('liveSummaryChanged', (event: { active: boolean; hasSpeech?: boolean }) => {
            ++revision;
            setState(previous => ({ ...previous, active: event.active, hasSpeech: event.hasSpeech }));
        });
        refresh();
        return () => {
            current = false;
            off();
        };
    }, [code]);

    const toggle = async (event: React.MouseEvent) => {
        event.stopPropagation();
        if (busy) return;
        if (!state.active && !open) onToggle?.();
        setBusy(true);
        try {
            const next = await signaling.request(state.active ? 'stopLiveSummary' : 'startLiveSummary');
            setState(next);
        } catch {
            // best-effort
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="meeting-summary-control" role="group" aria-label="AI summary">
            <button
                type="button"
                className={`meeting-summary-label ${open ? 'active' : ''}`}
                aria-expanded={open}
                aria-controls="meeting-summary-panel"
                onClick={onToggle}
                title="AI Meeting Summary"
            >
                <span className="mi" aria-hidden="true">auto_awesome</span>
                <span>AI summary</span>
            </button>
            {manager && (
                <button
                    type="button"
                    className="meeting-summary-switch"
                    role="switch"
                    aria-label="Toggle AI meeting summary"
                    aria-checked={state.active}
                    disabled={busy}
                    onClick={toggle}
                    title={state.active ? 'Stop live AI summary' : 'Start live AI summary'}
                >
                    <span />
                </button>
            )}
            <span className="meeting-summary-state" role="status">
                {state.active ? (state.hasSpeech ? 'Running' : 'Waiting for speech') : ''}
            </span>
        </div>
    );
}
