import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SiteNav from '../components/SiteNav';
import SiteFooter from '../components/SiteFooter';
import ActionContents from '../components/ActionContents';
import MeetingScene from '../components/MeetingScene';
import { AUTH_API, getToken } from '../lib/session';
import { intranetUrl } from '../lib/intranet-url';
import '../styles/service-pages.css';

const steps = [
    { title: 'Connect to your organisation', text: 'At the office, connect to your organisation’s network. When travelling, connect to the VPN supplied by your IT team first.' },
    { title: 'Choose browser or Windows', text: 'Approved accounts receive a workspace link and, when released, a Windows installer. Both connect to the same organisation-hosted service.' },
    { title: 'Check your devices and join', text: 'Sign in to your organisation’s workspace, check your camera and microphone, then join an authorised meeting. Your administrator manages access.' },
    { title: 'Work together', text: 'Meet with video, chat and screen sharing. Use available whiteboard, polls, Q&A and notes. Language features depend on your organisation’s configuration.' },
];
export default function IntranetPage() {
    const [access, setAccess] = useState<{ workspaceUrl: string; windowsAvailable: boolean } | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [step, setStep] = useState(0);
    const [downloading, setDownloading] = useState(false);
    useEffect(() => {
        const controller = new AbortController();
        const token = getToken();
        if (!token) { setLoading(false); return; }
        fetch(`${AUTH_API}/api/auth/enterprise`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
            .then(async response => {
                if (response.status === 401 || response.status === 403) return;
                if (!response.ok) throw new Error('We could not verify your access. Please retry or contact your administrator.');
                const data = await response.json();
                const url = intranetUrl(data.workspaceUrl);
                if (!url) throw new Error('Your workspace address needs administrator attention.');
                setAccess({ workspaceUrl: url, windowsAvailable: data.windowsAvailable === true });
            }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
            .finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, []);
    async function download() {
        setDownloading(true); setError('');
        try {
            const response = await fetch(`${AUTH_API}/api/auth/enterprise/windows`, { headers: { Authorization: `Bearer ${getToken()}` } });
            if (!response.ok) throw new Error('Download unavailable. Your access may have changed; contact your administrator.');
            const url = URL.createObjectURL(await response.blob());
            const link = document.createElement('a'); link.href = url; link.download = 'QS-VC-Windows-Setup.exe'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Download failed. Please retry.'); }
        finally { setDownloading(false); }
    }
    return <div className="public-site"><SiteNav /><main className="public-container service-page intranet-page" id="main-content">
        <header className="public-page-intro"><h1>{access ? 'Your enterprise workspace.' : 'Meet inside your organisation.'}</h1><p>{access ? 'Choose how you connect to your approved workspace.' : 'Explore the intranet experience before your organisation gets access.'}</p></header>
        {loading ? <p role="status">Checking enterprise access…</p> : access ? <div className="intranet-layout">
            <section className="service-card"><span className="enterprise-access-badge">Approved enterprise access</span><h2>Open in your browser</h2><p>Connect to your office network or approved VPN, then sign in to your organisation’s workspace.</p><p className="enterprise-address">{access.workspaceUrl}</p><a className="qsvc-action" href={access.workspaceUrl} rel="noreferrer"><ActionContents>Open workspace</ActionContents></a></section>
            <section className="service-card"><h2>QS-VC for Windows</h2><p>Access the same organisation workspace from the Windows desktop client. Your office network or VPN is still required.</p><button className="qsvc-action" type="button" disabled={!access.windowsAvailable || downloading} onClick={download}><ActionContents>{downloading ? 'Downloading…' : 'Download for Windows'}</ActionContents></button>{!access.windowsAvailable && <p role="status">Your Windows installer has not been released yet.</p>}<p>After installation, use the organisation address above. A download does not grant additional meeting permissions.</p></section>
        </div> : <><div className="intranet-layout"><section className="service-card"><span className="enterprise-access-badge">Guided demo · No live connection</span><h2>See what to expect</h2><MeetingScene /><p>This preview uses sample participants. It does not start your camera, microphone or a meeting.</p></section><section className="service-card"><div className="intranet-guide-tabs" aria-label="Guide steps">{steps.map((item, index) => <button type="button" key={item.title} aria-pressed={step === index} onClick={() => setStep(index)}>{index + 1}<span className="sr-only"> {item.title}</span></button>)}</div><div aria-live="polite"><h2>{steps[step].title}</h2><p>{steps[step].text}</p></div><div className="intranet-guide-controls"><button type="button" disabled={step === 0} onClick={() => setStep(value => value - 1)}>Back</button><button type="button" disabled={step === steps.length - 1} onClick={() => setStep(value => value + 1)}>Next</button></div><p>Local access can work without internet only when your organisation has installed all required services locally. Remote access needs a working VPN and office internet connection.</p><Link className="qsvc-action" to="/contact?interest=Intranet"><ActionContents>Request access</ActionContents></Link><p><Link to="/login">Already approved? Sign in</Link>, then return to Intranet.</p></section></div></>}
        {error && <p role="alert">{error}</p>}
    </main><SiteFooter /></div>;
}
