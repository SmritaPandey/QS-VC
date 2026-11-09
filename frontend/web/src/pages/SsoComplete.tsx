import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { beginSignIn, nextPath } from '../lib/session';
import { ssoRequest } from '../lib/sso';

export default function SsoComplete() {
    const navigate = useNavigate();
    const started = useRef(false);
    const [message, setMessage] = useState('Verifying your sign-in…');
    useEffect(() => {
        if (started.current) return;
        started.current = true;
        const result = new URLSearchParams(window.location.hash.slice(1));
        window.history.replaceState(window.history.state, '', window.location.pathname);
        async function complete() {
            if (result.has('test')) {
                setMessage('Organisation sign-in verified. You can return to SSO settings.');
                return;
            }
            if (result.get('error') === 'digilocker_failed') {
                sessionStorage.removeItem('qsvc-digilocker');
                throw new Error('DigiLocker consent could not be verified. Return to sign-in settings and try again.');
            }
            if (result.has('digilocker')) {
                const verifier = sessionStorage.getItem('qsvc-digilocker');
                sessionStorage.removeItem('qsvc-digilocker');
                if (!verifier) throw new Error('Start DigiLocker consent from this browser tab.');
                await ssoRequest('digilocker/complete', 'POST', { code: result.get('digilocker'), verifier }, true);
                setMessage('DigiLocker connected. QS-VC saved your DigiLocker ID and consent time.');
                return;
            }
            const stored = sessionStorage.getItem('qsvc-sso');
            sessionStorage.removeItem('qsvc-sso');
            if (!stored || !result.has('code')) throw new Error('The request could not be verified. Start again from QS-VC.');
            const { verifier, search } = JSON.parse(stored);
            const finish = beginSignIn();
            const { token } = await ssoRequest<{ token: string }>('exchange', 'POST', { code: result.get('code'), verifier });
            if (finish(token)) navigate(nextPath(search), { replace: true });
        }
        void complete().catch(error => setMessage(error instanceof Error ? error.message : 'Sign-in could not be verified.'));
    }, [navigate]);
    return <main className="public-site public-container public-auth-layout">
        <div className="public-auth-copy">
            <h1>Organisation sign-in</h1>
            <p role="status">{message}</p>
            <Link className="public-text-link" to="/login">Back to sign in</Link>
            {' · '}<Link className="public-text-link" to="/organisation/sso">SSO settings</Link>
        </div>
    </main>;
}
