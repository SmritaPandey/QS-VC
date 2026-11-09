import PersonalSignInButtons from '../components/PersonalSignInButtons';
import ActionContents from '../components/ActionContents';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AUTH_API, beginSignIn, nextPath } from '../lib/session';
import { useSession } from '../lib/use-session';
import SiteNav from '../components/SiteNav';
import SiteFooter from '../components/SiteFooter';
import { browserProof, ssoRequest } from '../lib/sso';

export default function Login() {
    const navigate = useNavigate();
    const location = useLocation();
    const [busy, setBusy] = useState<'password' | 'organisation'>();
    const [error, setError] = useState('');
    const emailInput = useRef<HTMLInputElement>(null);
    const session = useSession();
    const signedOutNotice = (location.state as { notice?: string } | null)?.notice;
    // Already signed in (e.g. Back after signing in, or a stale bookmark): go where they were heading.
    useEffect(() => {
        if (session.status === 'authenticated' && !busy) navigate(nextPath(location.search, session.profile?.role === 'admin' ? '/admin' : '/app'), { replace: true });
    }, [session.status, session.profile?.role, busy, navigate, location.search]);
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy) return;
        const fields = new FormData(event.currentTarget);
        const completeSignIn = beginSignIn();
        setBusy('password'); setError('');
        try {
            const response = await fetch(`${AUTH_API}/api/auth/login`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: fields.get('email'), password: fields.get('password'), tenantSlug: fields.get('tenantSlug') || undefined }),
            });
            const data = await response.json();
            if (!response.ok || typeof data.token !== 'string' || !data.token) throw new Error(data.error || 'Sign in failed. Please try again.');
            if (!completeSignIn(data.token)) return;
            navigate(nextPath(location.search, data.user?.role === 'admin' ? '/admin' : '/app'), { replace: true });
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Cannot reach sign in. Please try again.');
        } finally { setBusy(undefined); }
    }
    async function startSSO() {
        const input = emailInput.current;
        if (busy || !input?.reportValidity()) return;
        const email = input.value;
        setBusy('organisation'); setError('');
        try {
            const { verifier, challenge } = await browserProof();
            const result = await ssoRequest<{ url: string }>('start', 'POST', { email, challenge });
            sessionStorage.setItem('qsvc-sso', JSON.stringify({ verifier, search: location.search }));
            window.location.assign(result.url);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Organisation sign-in is unavailable.');
            setBusy(undefined);
        }
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
            <form className="public-auth-form" onSubmit={submit} aria-busy={!!busy} aria-label="Sign in">
                <label className="field-label" htmlFor="login-email">Email</label>
                <input ref={emailInput} id="login-email" name="email" type="email" autoComplete="username" required maxLength={255}
                    className="input-meeting-code" />
                <label className="field-label" htmlFor="login-password">Password</label>
                <input id="login-password" name="password" type="password" autoComplete="current-password" required maxLength={128}
                    className="input-meeting-code" />
                {signedOutNotice && !error && <p role="status" className="public-auth-notice">{signedOutNotice}</p>}
                {error && <p role="alert">{error}</p>}
                <button className="public-primary qsvc-action" disabled={!!busy}>
                    <ActionContents>{busy === 'password' ? 'Signing in…' : 'Sign in'}</ActionContents>
                </button>
                <PersonalSignInButtons disabled={!!busy} onOrganisationSignIn={() => void startSSO()} />
                <p>Need an account? <Link to={`/signup${location.search}`}>Sign up</Link></p>
            </form>
        </main>
        <SiteFooter />
    </div>;
}
