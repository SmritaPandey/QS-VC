import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { beginSignIn, nextPath } from '../lib/session';
import { ssoRequest } from '../lib/sso';
import SiteNav from '../components/SiteNav';

type Enrolment = { code: string; name: string; email?: string; verifiedEmail?: string };
type Result = { token?: string; linked?: boolean; enrol?: Enrolment; verification?: string; email?: string };
type Attempt = { verifier: string; search: string; link: boolean };

export default function PersonalSignInComplete() {
    const navigate = useNavigate();
    const started = useRef(false);
    const attempt = useRef<Attempt | null>(null);
    const finishSignIn = useRef<ReturnType<typeof beginSignIn> | null>(null);
    const [busy, setBusy] = useState(true);
    const [message, setMessage] = useState('Verifying your sign-in…');
    const [error, setError] = useState('');
    const [enrol, setEnrol] = useState<Enrolment>();
    const [verification, setVerification] = useState<{ code: string; email: string }>();

    function apply(result: Result) {
        if (result.linked) {
            setMessage('Your sign-in method is connected.');
        } else if (result.token) {
            if (finishSignIn.current?.(result.token)) navigate(nextPath(attempt.current?.search || ''), { replace: true });
        } else if (result.enrol) {
            setMessage('');
            setEnrol(result.enrol);
        } else if (result.verification && result.email) {
            setEnrol(undefined);
            setVerification({ code: result.verification, email: result.email });
        } else throw new Error('This sign-in could not be completed.');
    }

    useEffect(() => {
        if (started.current) return;
        started.current = true;
        const params = new URLSearchParams(window.location.hash.slice(1));
        window.history.replaceState(window.history.state, '', window.location.pathname);
        async function complete() {
            const stored = sessionStorage.getItem('qsvc-personal-sign-in');
            sessionStorage.removeItem('qsvc-personal-sign-in');
            if (!stored || !params.has('code')) throw new Error('Sign-in could not be verified. Start again from QS-VC.');
            const request = JSON.parse(stored) as Attempt;
            attempt.current = request;
            if (!request.link) finishSignIn.current = beginSignIn();
            apply(await ssoRequest<Result>('personal/exchange', 'POST', { code: params.get('code'), verifier: request.verifier }, request.link));
        }
        void complete().catch(reason => { setMessage(''); setError(reason.message); }).finally(() => setBusy(false));
        // This callback consumes a one-time proof.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navigate]);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!attempt.current || busy) return;
        const fields = Object.fromEntries(new FormData(event.currentTarget));
        setBusy(true); setError('');
        try {
            const route = verification ? 'personal/verify-email' : 'personal/signup';
            apply(await ssoRequest<Result>(route, 'POST', {
                ...fields, code: verification?.code ?? enrol?.code, verifier: attempt.current.verifier,
            }));
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Sign-in could not be completed.'); }
        finally { setBusy(false); }
    }

    return <div className="public-site">
        <SiteNav />
        <main id="main-content" className="public-container public-auth-layout">
            <div className="public-auth-copy">
                <h1>{verification ? 'Check your email' : enrol ? 'Finish creating your account' : 'Continue to QS-VC'}</h1>
                {message && <p role="status">{message}</p>}
                {error && <p role="alert">{error}</p>}
                <Link className="public-text-link" to={attempt.current?.link ? '/organisation/sso' : `/login${attempt.current?.search || ''}`}>
                    {attempt.current?.link ? 'Back to sign-in settings' : 'Back to sign in'}
                </Link>
            </div>
            {enrol && <form className="public-auth-form" onSubmit={submit} aria-label="Create a personal account" aria-busy={busy}>
                <label htmlFor="personal-name">Your name</label>
                <input id="personal-name" name="displayName" defaultValue={enrol.name} autoComplete="name" required maxLength={100} />
                <label htmlFor="personal-email">Email</label>
                <input id="personal-email" name="email" type="email" defaultValue={enrol.verifiedEmail || enrol.email} autoComplete="email" required maxLength={255} readOnly={!!enrol.verifiedEmail} />
                <label htmlFor="personal-phone">Mobile number with country code</label>
                <input id="personal-phone" name="phoneNumber" type="tel" autoComplete="tel" placeholder="+91 98765 43210" required maxLength={24} />
                <p>By creating an account, you agree to our <Link to="/terms">Terms</Link>. Read our <Link to="/privacy">Privacy Policy</Link>.</p>
                <button className="public-primary qsvc-action" disabled={busy}>{enrol.verifiedEmail ? 'Create account' : 'Send verification code'}</button>
            </form>}
            {verification && <form className="public-auth-form" onSubmit={submit} aria-label="Verify your email" aria-busy={busy}>
                <p>Enter the eight-digit code sent to {verification.email}.</p>
                <label htmlFor="personal-otp">Verification code</label>
                <input id="personal-otp" name="otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" maxLength={8} required />
                <button className="public-primary qsvc-action" disabled={busy}>Verify and create account</button>
            </form>}
        </main>
    </div>;
}
