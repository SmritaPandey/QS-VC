import { useRef, useState } from 'react';
import { clearSession, getToken } from '../lib/session';

const API = import.meta.env.VITE_MEETING_URL || import.meta.env.VITE_API_URL || '';

export default function CancelScheduledMeeting({ id, title, onCancelled, onExpired }: {
    id: string;
    title: string;
    onCancelled: () => void;
    onExpired?: () => void;
}) {
    const pending = useRef(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const cancel = async () => {
        if (pending.current || !window.confirm(`Cancel “${title}”? Its join link will stop working. Update any external calendar invitations separately.`)) return;
        const token = getToken();
        if (!token) return;
        pending.current = true;
        setBusy(true);
        setError('');
        try {
            const response = await fetch(`${API}/api/meetings/${encodeURIComponent(id)}/schedule`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'cancel' }),
                signal: AbortSignal.timeout(10000),
            });
            if (getToken() !== token) return;
            if (response.status === 401) { if (clearSession(token)) onExpired?.(); return; }
            if (response.status === 404) {
                setError('This meeting can no longer be cancelled here. Refresh your meetings to check its status.');
                return;
            }
            if (!response.ok) throw new Error('Cancellation failed');
            onCancelled();
        } catch {
            if (getToken() === token) setError('Could not confirm cancellation. Check the meeting status or try again.');
        } finally {
            pending.current = false;
            setBusy(false);
        }
    };

    return <>
        <button type="button" className="workspace-row-join workspace-row-secondary" disabled={busy}
            aria-label={busy ? undefined : `Cancel meeting: ${title}`} onClick={() => void cancel()}>
            {busy ? 'Cancelling…' : 'Cancel meeting'}
        </button>
        {error && <span role="alert">{error}</span>}
    </>;
}
