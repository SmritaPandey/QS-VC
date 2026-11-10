import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import SiteNav from '../components/SiteNav';
import SiteFooter from '../components/SiteFooter';
import PersonalSignInButtons from '../components/PersonalSignInButtons';
import IdentityOptions from '../components/IdentityOptions';
import ActionContents from '../components/ActionContents';
import { AUTH_API, beginSignIn, nextPath } from '../lib/session';
import { useSession } from '../lib/use-session';

export default function Signup() {
    const navigate = useNavigate();
    const location = useLocation();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const session = useSession();
    // Already signed in (e.g. Back after signing in, or a stale bookmark): go where they were heading.
    useEffect(() => {
        if (session.status === 'authenticated' && !busy) navigate(nextPath(location.search), { replace: true });
    }, [session.status, busy, navigate, location.search]);
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy) return;
        const fields = new FormData(event.currentTarget);
        const completeSignIn = beginSignIn();
        setBusy(true); setError('');
        try {
            const response = await fetch(`${AUTH_API}/api/auth/register`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ displayName: fields.get('displayName'), email: fields.get('email'), phoneNumber: fields.get('phoneNumber'), password: fields.get('password') }),
            });
            if (response.status === 400) { setError('Check your name, email, mobile number and password, then try again.'); return; }
            if (response.status === 403) { setError('Use your organisation sign-in for this email address.'); return; }
            if (response.status === 409) { setError('This email already has an account. Sign in to continue.'); return; }
            if (response.status === 429) { setError('Too many attempts. Wait a few minutes and try again.'); return; }
            const data = response.ok ? await response.json().catch(() => null) : null;
            if (typeof data?.token !== 'string' || !data.token) { setError('Could not create your account. Please try again.'); return; }
            if (!completeSignIn(data.token)) return;
            navigate(nextPath(location.search), { replace: true });
        } catch {
            setError('Could not create your account. Please try again.');
        } finally { setBusy(false); }
    }
    return <div className="public-site public-signup"><SiteNav />
        <main id="main-content" className="public-container public-auth-layout">
            <div className="public-auth-copy"><h1>Your next conversation starts here.</h1>
                <p>Create a free account. Choose a paid plan when you’re ready for more.</p>
                <p>Already have an account? <Link to="/login">Sign in</Link> to use your existing plan.</p>
                <p>Joining an enterprise? Use your organisation sign-in on the <Link to="/login">sign-in page</Link>.</p>
            </div>
            <form className="public-auth-form" onSubmit={submit} aria-label="Create an account" aria-busy={busy}>
                <label htmlFor="signup-name">Your name</label>
                <input id="signup-name" name="displayName" autoComplete="name" required maxLength={100} />
                <label htmlFor="signup-phone">Mobile number</label>
                <input id="signup-phone" name="phoneNumber" type="tel" autoComplete="tel" inputMode="tel" placeholder="+91 98765 43210" required maxLength={24} aria-describedby="signup-phone-help" />
                <p id="signup-phone-help">Include your country code. This number is saved to your account.</p>
                <label htmlFor="signup-email">Email</label>
                <input id="signup-email" name="email" type="email" autoComplete="email" required maxLength={255} />
                <label htmlFor="signup-password">Password</label>
                <input id="signup-password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} aria-describedby="signup-password-help" />
                <p id="signup-password-help">Use at least 8 characters.</p>
                {error && <p role="alert">{error}</p>}
                <p>By creating an account, you agree to our <Link to="/terms">Terms</Link>. Read our <Link to="/privacy">Privacy Policy</Link>.</p>
                <button className="public-primary qsvc-action" disabled={busy}><ActionContents>{busy ? 'Creating account…' : 'Create account'}</ActionContents></button>
                <PersonalSignInButtons disabled={busy} />
                <IdentityOptions />
                <p>Already have an account? <Link to={`/login${location.search}`}>Sign in</Link></p>
            </form>
        </main><SiteFooter /></div>;
}
