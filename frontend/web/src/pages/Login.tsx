import IdentityOptions from '../components/IdentityOptions';
import ActionContents from '../components/ActionContents';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AUTH_API, clearSession, nextPath } from '../lib/session';
import SiteNav from '../components/SiteNav';
import SiteFooter from '../components/SiteFooter';

export default function Login() {
    const navigate = useNavigate();
    const location = useLocation();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy) return;
        const fields = new FormData(event.currentTarget);
        setBusy(true); setError(''); clearSession();
        try {
            const response = await fetch(`${AUTH_API}/api/auth/login`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: fields.get('email'), password: fields.get('password'), tenantSlug: fields.get('tenantSlug') || undefined }),
            });
            const data = await response.json();
            if (!response.ok || !data.token) throw new Error(data.error || 'Sign in failed. Please try again.');
            sessionStorage.setItem('token', data.token);
            navigate(nextPath(location.search), { replace: true });
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Cannot reach sign in. Please try again.');
        } finally { setBusy(false); }
    }
    return <div className="public-site public-login">
        <SiteNav accountAction={<Link className="btn-secondary qsvc-action qsvc-action--secondary" to="/app"><ActionContents>Continue as guest</ActionContents></Link>} />
        <main id="main-content" className="public-container public-auth-layout">
            <div className="public-auth-copy">
                <h1>Sign in to QS-VC</h1>
                <p>Sign in to your account, or join a meeting as a guest.</p>
                <p>Check your camera and microphone before entering the meeting.</p>
                <Link className="public-text-link qsvc-action qsvc-action--secondary" to="/app"><ActionContents>Continue as guest</ActionContents></Link>
            </div>
            <form className="public-auth-form" onSubmit={submit} aria-busy={busy} aria-label="Sign in">
                <label className="field-label" htmlFor="login-email">Email</label>
                <input id="login-email" name="email" type="email" autoComplete="username" required maxLength={255} className="input-meeting-code" />
                <label className="field-label" htmlFor="login-password">Password</label>
                <input id="login-password" name="password" type="password" autoComplete="current-password" required maxLength={128} className="input-meeting-code" />
                {error && <p role="alert">{error}</p>}
                <button className="public-primary qsvc-action" disabled={busy}><ActionContents><span>{busy ? 'Signing in…' : 'Sign in'}</span></ActionContents></button>
                <IdentityOptions /><p>Need an account? <Link to={`/signup${location.search}`}>Sign up</Link></p>
            </form>
        </main>
        <SiteFooter />
    </div>;
}
