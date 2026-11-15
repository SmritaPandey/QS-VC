import { useEffect, useState } from 'react';
import { AUTH_API, clearSession, getToken } from '../lib/session';
import '../styles/download-leads.css';

type Lead = { id: string; name: string; email: string; platform: string; createdAt: string };
export default function DownloadLeads() {
    const [data, setData] = useState<{ leads: Lead[]; nextCursor: string | null }>();
    const [cursor, setCursor] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [syncedAt, setSyncedAt] = useState<Date>();
    useEffect(() => {
        const controller = new AbortController();
        const token = getToken();
        let fetching = false;
        async function refresh() {
            if (fetching) return;
            fetching = true;
            setLoading(true);
            try {
                const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
                const response = await fetch(`${AUTH_API}/api/auth/enterprise/download-leads${query}`, {
                    cache: 'no-store', headers: { Authorization: `Bearer ${token}` },
                    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
                });
                if (controller.signal.aborted || getToken() !== token) return;
                if (response.status === 401) { clearSession(token); throw new Error(); }
                if (response.status === 403) { setData(undefined); throw new Error(); }
                if (!response.ok) throw new Error();
                const result = await response.json();
                if (controller.signal.aborted || getToken() !== token) return;
                setData(result); setError(''); setSyncedAt(new Date());
            } catch {
                if (!controller.signal.aborted) setError('Download leads could not be synced. Try refreshing.');
            } finally {
                fetching = false;
                if (!controller.signal.aborted) setLoading(false);
            }
        }
        void refresh();
        const interval = window.setInterval(refresh, 30_000);
        return () => { controller.abort(); window.clearInterval(interval); };
    }, [cursor, attempt]);
    return <section aria-labelledby="download-leads-title">
        <div className="tab-header"><h2 id="download-leads-title">Download leads</h2><button className="btn-secondary" type="button" disabled={loading} onClick={() => setAttempt(value => value + 1)}>{loading ? 'Syncing…' : 'Refresh'}</button></div>
        <p>People who requested sales follow-up before downloading QS-VC. These requests do not confirm a completed download.</p>
        <p className="download-leads-meta">Refreshes every 30 seconds.{syncedAt && ` Last synced ${syncedAt.toLocaleTimeString()}.`}</p>
        {error && <p role="alert">{error}{data && ' Previously synced results are shown below.'}</p>}
        {!data && loading && <p role="status">Loading download leads…</p>}
        {data && (data.leads.length ? <div className="download-leads-table"><table className="admin-table">
            <caption className="sr-only">Sales follow-up requests, newest first</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Organisation email</th><th scope="col">Package</th><th scope="col">Requested</th></tr></thead>
            <tbody>{data.leads.map(lead => <tr key={lead.id}><td>{lead.name}</td><td>{lead.email}</td><td>{lead.platform}</td><td><time dateTime={lead.createdAt}>{new Date(lead.createdAt).toLocaleString()}</time></td></tr>)}</tbody>
        </table></div> : <p>No follow-up requests yet.</p>)}
        <div className="download-lead-actions">
            {cursor && <button className="btn-secondary" type="button" disabled={loading} onClick={() => { setCursor(null); setData(undefined); setSyncedAt(undefined); }}>Back to latest</button>}
            {data?.nextCursor && <button className="btn-secondary" type="button" disabled={loading} onClick={() => { setCursor(data.nextCursor); setData(undefined); setSyncedAt(undefined); }}>Older requests</button>}
        </div>
    </section>;
}
