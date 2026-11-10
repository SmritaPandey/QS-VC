import { useState, type FormEvent } from 'react';
import { AUTH_API, clearSession, getToken } from '../lib/session';

type Customer = {
    id: string;
    email: string;
    display_name: string;
    workspace_url: string | null;
    expires_at: string | null;
};

class AccessRequestError extends Error {}

const endpoint = `${AUTH_API}/api/auth/enterprise/terms`;

export default function EnterpriseAccessTerms() {
    const [customer, setCustomer] = useState<Customer | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    async function request(url: string, options?: RequestInit) {
        const token = getToken();
        const response = await fetch(url, {
            ...options,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(8000),
        });
        if (getToken() !== token) throw new AccessRequestError('The signed-in account changed.');
        if (response.status === 401) clearSession(token);
        if (!response.ok) {
            const errors: Record<number, string> = {
                400: 'Check the email, workspace URL and expiry.',
                401: 'Sign in again to manage access.',
                403: 'Only platform admins can manage access.',
                404: 'No active customer account was found.',
                409: 'Multiple accounts match this email. Resolve the duplicate before approving access.',
            };
            throw new AccessRequestError(errors[response.status] || 'Access settings are unavailable. Try again.');
        }
        return response.json();
    }

    async function findCustomer(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy) return;
        const email = String(new FormData(event.currentTarget).get('email') || '').trim();
        setCustomer(null);
        setMessage('');
        setError('');
        setBusy(true);
        try {
            setCustomer(await request(`${endpoint}?${new URLSearchParams({ email })}`));
        } catch (reason) {
            setError(reason instanceof AccessRequestError ? reason.message : 'Customer lookup failed.');
        } finally {
            setBusy(false);
        }
    }

    async function saveTerm(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy || !customer) return;
        const fields = new FormData(event.currentTarget);
        const expires = new Date(String(fields.get('expiresAt') || ''));
        setMessage('');
        setError('');
        if (!Number.isFinite(expires.getTime()) || expires.getTime() <= Date.now()) {
            setError('Choose an expiry in the future.');
            return;
        }
        setBusy(true);
        try {
            const term = await request(`${endpoint}/${encodeURIComponent(customer.id)}`, {
                method: 'PUT',
                body: JSON.stringify({ workspaceUrl: String(fields.get('workspaceUrl')).trim(), expiresAt: expires.toISOString() }),
            });
            setCustomer({ ...customer, workspace_url: term.workspace_url, expires_at: term.expires_at });
            setMessage(`Access saved through ${new Date(term.expires_at).toLocaleString()}.`);
        } catch (reason) {
            setError(reason instanceof AccessRequestError ? reason.message : 'Access could not be saved.');
        } finally {
            setBusy(false);
        }
    }

    return <section className="admin-section" aria-labelledby="enterprise-terms-title">
        <h2 id="enterprise-terms-title">Quantum-Premise access terms</h2>
        <form onSubmit={findCustomer}>
            <label htmlFor="enterprise-customer-email">Customer email</label>{' '}
            <input id="enterprise-customer-email" name="email" type="email" required maxLength={255} />{' '}
            <button type="submit" disabled={busy}>Find customer</button>
        </form>
        {customer && <form key={customer.id} onSubmit={saveTerm}>
            <p>{customer.display_name} ({customer.email})</p>
            <p>{customer.expires_at ? `Current expiry: ${new Date(customer.expires_at).toLocaleString()}` : 'No dated access term.'}</p>
            <p>Choose the agreed end date for the monthly, annual, or custom term.</p>
            <div><label htmlFor="enterprise-workspace-url">HTTPS workspace URL</label>{' '}
                <input id="enterprise-workspace-url" name="workspaceUrl" type="url" required maxLength={2048} defaultValue={customer.workspace_url || ''} /></div>
            <div><label htmlFor="enterprise-expires-at">Access ends in your local time</label>{' '}
                <input id="enterprise-expires-at" name="expiresAt" type="datetime-local" required /></div>
            <button type="submit" disabled={busy}>Save access term</button>
        </form>}
        {busy && <p role="status">Working…</p>}
        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
    </section>;
}
