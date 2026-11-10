import { useRef, useState } from 'react';
import { clearSession, getToken } from '../lib/session';
import { SignalingClient } from '../lib/signaling';

const API = import.meta.env.VITE_MEETING_URL || import.meta.env.VITE_API_URL || '';

export default function CancelScheduledMeeting({ id, title, meetingCode, instant = false, active = false, onCancelled, onExpired }: {
    id: string;
    title: string;
    meetingCode?: string;
    instant?: boolean;
    active?: boolean;
    onCancelled: () => void;
    onExpired?: () => void;
}) {
    const pending = useRef(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const cancel = async () => {
        if (pending.current || !window.confirm(active
            ? `End “${title}” for everyone? Everyone in the meeting and waiting room will be disconnected. You can start it again with the same link.`
            : `Cancel “${title}”? Its join link will stop working.${instant ? ' Anyone waiting to join will be disconnected.' : ' Update any external calendar invitations separately.'}`)) return;
        const token = getToken();
        if (!token) { onExpired?.(); return; }
        pending.current = true;
        setBusy(true);
        setError('');
        try {
            if (active || instant) {
                if (!meetingCode) throw new Error('Meeting code is missing');
                const client = new SignalingClient();
                let timeout: ReturnType<typeof setTimeout> | undefined;
                let finished = false;
                try {
                    await Promise.race([
                        (async () => {
                            await client.connect(meetingCode);
                            if (finished || getToken() !== token) { client.disconnect(); throw new Error('Request expired'); }
                            await client.request('endHostedMeeting', { meetingCode, action: active ? 'end' : 'cancel' });
                        })(),
                        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Ending timed out')), 20000); }),
                    ]);
                } finally { finished = true; clearTimeout(timeout); client.disconnect(); }
                if (getToken() === token) onCancelled();
                return;
            }
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
            if (getToken() === token) setError(active
                ? 'Could not confirm the meeting ended. Check its status or try again.'
                : 'Could not confirm cancellation. Check the meeting status or try again.');
            else if (!getToken()) onExpired?.();
        } finally {
            pending.current = false;
            setBusy(false);
        }
    };

    return <>
        <button type="button" className="workspace-row-join workspace-row-secondary" disabled={busy}
            aria-label={busy ? undefined : `${active ? 'End meeting for everyone' : 'Cancel meeting'}: ${title}`} onClick={() => void cancel()}>
            {busy ? (active ? 'Ending…' : 'Cancelling…') : (active ? 'End meeting' : 'Cancel meeting')}
        </button>
        {error && <span role="alert">{error}</span>}
    </>;
}
