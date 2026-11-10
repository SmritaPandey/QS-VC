import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import PersonalSignInButtons from '../components/PersonalSignInButtons';
import SiteNav from '../components/SiteNav';
import { useSession } from '../lib/use-session';
import { browserProof, SignInRequestError, ssoRequest } from '../lib/sso';
import '../styles/organisation-sso.css';

type Connection = {
    id: string; domain: string; verified: boolean; tested: boolean; enforced: boolean;
    provider: 'oidc' | 'saml' | null; txtName: string; txtValue: string; metadataUrl: string; redirectUrl: string;
};
const oidcFields = [
    ['issuer', 'Issuer URL'], ['authorizationUrl', 'Authorisation URL'], ['tokenUrl', 'Token URL'],
    ['jwksUrl', 'Signing keys URL (JWKS)'], ['clientId', 'Client ID'], ['clientSecret', 'Client secret'],
];

export default function OrganisationSso() {
    const session = useSession();
    const [connections, setConnections] = useState<Connection[]>([]);
    const [admin, setAdmin] = useState(false);
    const [link, setLink] = useState(false);
    const [digilocker, setDigilocker] = useState(false);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');

    async function refresh() {
        const settings = await ssoRequest<{ admin: boolean; link: boolean }>('availability', 'GET', undefined, true);
        setAdmin(settings.admin); setLink(settings.link);
        if (settings.admin) setConnections((await ssoRequest<{ connections: Connection[] }>('connections', 'GET', undefined, true)).connections);
    }
    const accountId = session.profile?.id;
    useEffect(() => {
        if (!accountId) return;
        setLoading(true);
        Promise.all([
            refresh(),
            ssoRequest<{ enabled: boolean }>('digilocker/status').then(result => setDigilocker(result.enabled)),
        ]).catch(() => setError('Sign-in settings could not be loaded.')).finally(() => setLoading(false));
    }, [accountId]);

    async function run(action: () => Promise<void>) {
        if (busy) return;
        setBusy(true); setError(''); setNotice('');
        try { await action(); } catch (reason) { setError(reason instanceof SignInRequestError ? reason.message : 'The change could not be completed. Try again.'); }
        finally { setBusy(false); }
    }
    const save = (path: string, method: string, body?: object) => run(async () => {
        await ssoRequest(path, method, body, true);
        await refresh();
        setNotice('Settings updated.');
    });
    const navigateTo = (path: string, body: object = {}) => run(async () => {
        const { url } = await ssoRequest<{ url: string }>(path, 'POST', body, true);
        window.location.assign(url);
    });
    function configure(event: FormEvent<HTMLFormElement>, connection: Connection) {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        void run(async () => {
            const file = fields.get('metadata');
            if (fields.get('provider') === 'saml' && (!(file instanceof File) || !file.size || file.size > 80000)) {
                setError('Choose a SAML XML file up to 80 KB.');
                return;
            }
            const body = fields.get('provider') === 'saml' && file instanceof File
                ? { provider: 'saml', metadata: await file.text() }
                : { provider: 'oidc', ...Object.fromEntries(oidcFields.map(([name]) => [name, fields.get(name)])) };
            await ssoRequest(`connections/${connection.id}/provider`, 'PUT', body, true);
            await refresh();
            setNotice('Identity provider saved. Test it before requiring SSO.');
        });
    }

    if (session.status === 'anonymous') return <Navigate to="/login?next=%2Forganisation%2Fsso" replace />;
    return <div className="public-site">
        <SiteNav />
        <main id="main-content" className="public-container organisation-sso">
            <Link className="public-text-link" to="/app">Back to meetings</Link>
            <h1>Sign-in settings</h1>
            {loading && !error && <p role="status">Loading sign-in settings…</p>}
            {error && <p role="alert">{error}</p>}
            {notice && <p role="status">{notice}</p>}
            {!loading && !admin && !link && !digilocker && <p>Organisation SSO settings are available to Enterprise administrators.</p>}
            {link && <section className="public-auth-form">
                <h2>Link your account</h2>
                <p>Verify your organisation identity while signed in to keep using this QS-VC account with SSO.</p>
                <button type="button" className="public-primary qsvc-action" disabled={busy} onClick={() => void navigateTo('link')}>Verify my organisation sign-in</button>
            </section>}
            {admin && <form className="public-auth-form" onSubmit={event => {
                event.preventDefault();
                void save('connections', 'POST', { domain: new FormData(event.currentTarget).get('domain') });
            }}>
                <h2>Add a domain</h2>
                <label>Organisation domain <input className="input-meeting-code" name="domain" placeholder="example.com" maxLength={253} required /></label>
                <button className="public-primary qsvc-action" disabled={busy}>Add domain</button>
            </form>}
            {admin && connections.map(connection => <section key={connection.id} className="public-auth-form">
                <h2>{connection.domain}</h2>
                <p>{connection.verified ? 'Domain verified' : 'Awaiting DNS verification'}{connection.provider ? ` · ${connection.provider.toUpperCase()}` : ''}</p>
                {!connection.verified && <>
                    <p>Add a DNS TXT record using these values.</p>
                    <dl><dt>Record name</dt><dd><code>{connection.txtName}</code></dd><dt>Record value</dt><dd><code>{connection.txtValue}</code></dd></dl>
                    <button type="button" className="qsvc-action qsvc-action--secondary" disabled={busy}
                        onClick={() => void save(`connections/${connection.id}/verify`, 'POST', {})}>Verify DNS record</button>
                </>}
                {connection.verified && <>
                    <p>Use this callback URL when configuring your identity provider.</p>
                    <code>{connection.redirectUrl}</code>
                    {connection.provider === 'saml' && <a href={connection.metadataUrl} target="_blank" rel="noreferrer">Open SAML SP metadata</a>}
                    {!connection.provider && <ProviderForm configure={event => configure(event, connection)} busy={busy} />}
                    {connection.provider && <>
                        <form className="organisation-sso-fields" onSubmit={event => {
                            event.preventDefault();
                            void navigateTo(`connections/${connection.id}/test`, { email: new FormData(event.currentTarget).get('email') });
                        }}>
                            <label>Test account email <input className="input-meeting-code" type="email" name="email" required maxLength={255}
                                defaultValue={session.profile?.email.endsWith(`@${connection.domain}`) ? session.profile.email : ''} /></label>
                            <button className="qsvc-action qsvc-action--secondary" disabled={busy}>Test connection</button>
                        </form>
                        <p>{connection.tested ? 'Connection tested successfully.' : 'A successful test is required before enforcing SSO.'}</p>
                        <label className="organisation-sso-toggle"><input type="checkbox" checked={connection.enforced} disabled={busy || !connection.tested}
                            onChange={event => void save(`connections/${connection.id}/enforcement`, 'PATCH', { enforced: event.target.checked })} />
                            Require SSO for this domain
                        </label>
                    </>}
                </>}
            </section>)}
            {session.status === 'authenticated' && <PersonalSignInButtons key={accountId} link />}
            {digilocker && <section className="public-auth-form">
                <h2>DigiLocker</h2>
                <p>Connect DigiLocker with your consent. QS-VC saves your DigiLocker ID and when you consented.</p>
                <button type="button" className="qsvc-action qsvc-action--secondary" disabled={busy} onClick={() => void run(async () => {
                    const { verifier, challenge } = await browserProof();
                    const { url } = await ssoRequest<{ url: string }>('digilocker/start', 'POST', { challenge }, true);
                    sessionStorage.setItem('qsvc-digilocker', verifier);
                    window.location.assign(url);
                })}>Connect DigiLocker</button>
            </section>}
        </main>
    </div>;
}

function ProviderForm({ configure, busy }: { configure: (event: FormEvent<HTMLFormElement>) => void; busy: boolean }) {
    const [provider, setProvider] = useState('oidc');
    return <form className="organisation-sso-fields" onSubmit={configure}>
        <label>Identity provider protocol
            <select className="input-meeting-code" name="provider" value={provider} onChange={event => setProvider(event.target.value)}>
                <option value="oidc">OpenID Connect</option><option value="saml">SAML 2.0</option>
            </select>
        </label>
        {provider === 'saml' ? <label>SAML metadata XML
            <input className="input-meeting-code" name="metadata" type="file" accept=".xml,application/xml,text/xml" required />
        </label> : oidcFields.map(([name, label]) => <label key={name}>{label}
            <input className="input-meeting-code" type={name === 'clientSecret' ? 'password' : name === 'clientId' ? 'text' : 'url'}
                name={name} autoComplete="off" required />
        </label>)}
        <button className="public-primary qsvc-action" disabled={busy}>Save identity provider</button>
    </form>;
}
