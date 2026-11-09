import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import ActionContents from './ActionContents';
import { browserProof, ssoRequest } from '../lib/sso';

type Provider = 'google' | 'microsoft';
const names = { google: 'Google', microsoft: 'Microsoft' };

export default function PersonalSignInButtons({ link = false, disabled = false, onOrganisationSignIn }: {
    link?: boolean; disabled?: boolean; onOrganisationSignIn?: () => void;
}) {
    const { search } = useLocation();
    const [providers, setProviders] = useState<Provider[]>();
    const [connected, setConnected] = useState<Provider[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        let current = true;
        void ssoRequest<{ providers: Provider[]; connected?: Provider[] }>(
            link ? 'personal/connections' : 'personal/providers', 'GET', undefined, link,
        ).then(result => {
            if (current) { setProviders(result.providers); setConnected(result.connected || []); }
        }).catch(() => { if (current) setProviders([]); });
        return () => { current = false; };
    }, [link]);

    async function start(provider: Provider) {
        setBusy(true); setError('');
        try {
            const { verifier, challenge } = await browserProof();
            const { url } = await ssoRequest<{ url: string }>('personal/start', 'POST', { provider, challenge, link }, link);
            sessionStorage.setItem('qsvc-personal-sign-in', JSON.stringify({ verifier, search, link }));
            window.location.assign(url);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Sign-in could not be started.');
            setBusy(false);
        }
    }
    const visibleProviders: Provider[] = onOrganisationSignIn ? ['google', 'microsoft'] : providers ?? [];
    if (!visibleProviders.length) return null;
    return <div className="identity-options" aria-label={link ? 'Linked sign-in methods' : 'Other sign-in methods'}>
        <p>{link ? 'Personal sign-in methods' : 'Or continue with'}</p>
        <div className="identity-options-grid">
            {visibleProviders.map(provider => connected.includes(provider)
                ? <p key={provider}>{names[provider]} connected</p>
                : <button key={provider} type="button" className="qsvc-action qsvc-action--secondary" disabled={busy || disabled || !providers?.includes(provider)}
                    onClick={() => void start(provider)}><ActionContents>{link ? `Link ${names[provider]}` : onOrganisationSignIn ? names[provider] : `Continue with ${names[provider]}`}</ActionContents></button>)}
        </div>
        {onOrganisationSignIn && <>
            <button type="button" className="qsvc-action qsvc-action--secondary" disabled={busy || disabled} onClick={onOrganisationSignIn}>
                <ActionContents>Organisation SSO / SAML</ActionContents>
            </button>
            {providers && providers.length < visibleProviders.length && <p>
                {visibleProviders.filter(provider => !providers.includes(provider)).map(provider => names[provider]).join(' and ')} sign-in is unavailable on this workspace.
            </p>}
        </>}
        {error && <p role="alert">{error}</p>}
    </div>;
}
