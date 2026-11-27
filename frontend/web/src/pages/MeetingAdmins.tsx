import ActionContents from '../components/ActionContents';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import SiteNav from '../components/SiteNav';
import { AUTH_API, getToken } from '../lib/session';
import { useSession } from '../lib/use-session';
import '../styles/organisation-sso.css';

type AdminRole = 'admin' | 'co_admin';
type MeetingAdmin = { id: string; email: string; displayName: string; role: AdminRole };

async function request(token: string, path = '', options: RequestInit = {}) {
    return fetch(`${AUTH_API}/api/auth/meeting-admins${path}`, {
        ...options,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        signal: options.signal || AbortSignal.timeout(10000),
    });
}

function AdminSettings({ token }: { token: string }) {
    const [admins, setAdmins] = useState<MeetingAdmin[]>([]);
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<AdminRole>('admin');
    const [ready, setReady] = useState(false);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');

    async function load(signal?: AbortSignal) {
        const response = await request(token, '', { signal });
        if (!response.ok) throw new Error(response.status === 403 ? 'An active Business or approved Enterprise plan is required.' : 'Could not load meeting admins.');
        const result = await response.json() as { admins: MeetingAdmin[] };
        if (!signal?.aborted) setAdmins(result.admins);
    }

    useEffect(() => {
        const controller = new AbortController();
        load(controller.signal).then(() => { if (!controller.signal.aborted) setReady(true); })
            .catch(error => { if (!controller.signal.aborted) setError(error.message); });
        return () => controller.abort();
    }, [token]);

    async function change(path: string, options: RequestInit, success: string) {
        if (busy) return;
        setBusy(true); setError(''); setNotice('');
        try {
            const response = await request(token, path, options);
            if (!response.ok) {
                const detail = await response.json().catch(() => null);
                throw new Error(detail?.error || 'Could not change meeting access. Try again.');
            }
            await load();
            setNotice(success);
            return true;
        } catch (error) {
            setError(error instanceof Error ? error.message : 'Could not change meeting access.');
        } finally { setBusy(false); }
    }

    async function save(event: FormEvent) {
        event.preventDefault();
        if (await change('', { method: 'PUT', body: JSON.stringify({ email, role }) }, 'Meeting access saved.')) setEmail('');
    }

    return <>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {!ready && !error && <p role="status">Loading meeting admins…</p>}
        {ready && <>
            <form className="public-auth-form" onSubmit={save}>
                <label>Account email <input required type="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
                <label>Role <select value={role} onChange={event => setRole(event.target.value as AdminRole)}>
                    <option value="admin">Admin</option>
                    <option value="co_admin">Co-admin</option>
                </select></label>
                <button className="qsvc-action" disabled={busy}><ActionContents>Save access</ActionContents></button>
            </form>
            <h2>People with access</h2>
            {!admins.length && <p>No meeting admins have been assigned.</p>}
            <ul>{admins.map(admin => <li key={admin.id}>
                <p>{admin.displayName} ({admin.email}) · {admin.role === 'admin' ? 'Admin' : 'Co-admin'}</p>
                <button type="button" className="qsvc-action qsvc-action--secondary" disabled={busy}
                    onClick={() => void change(`/${encodeURIComponent(admin.id)}`, { method: 'DELETE' }, 'Meeting access removed.')}><ActionContents>Remove access</ActionContents></button>
            </li>)}</ul>
        </>}
    </>;
}

export default function MeetingAdmins() {
    const session = useSession();
    const token = session.status === 'authenticated' ? getToken() : '';
    return <div className="public-site"><SiteNav /><main id="main-content" className="public-container organisation-sso">
        <Link to="/app">Back to meetings</Link>
        <h1>Meeting admins</h1>
        <p>Admins can view your meetings, cancel waiting meetings, and end live meetings for everyone. Co-admins can view your meetings.</p>
        {token ? <AdminSettings key={token} token={token} /> : <p>Sign in to manage access to your meetings.</p>}
    </main></div>;
}
