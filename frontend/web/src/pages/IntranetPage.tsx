import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import SiteNav from '../components/SiteNav';
import SiteFooter from '../components/SiteFooter';
import ActionContents from '../components/ActionContents';
import MeetingScene from '../components/MeetingScene';
import DownloadFeedback, { type DownloadState } from '../components/DownloadFeedback';
import { AUTH_API, clearSession, getToken, refreshSession } from '../lib/session';
import { useSession } from '../lib/use-session';
import { intranetUrl } from '../lib/intranet-url';
import '../styles/service-pages.css';

const steps = [
    { title: 'Connect to your organisation', text: 'At the office, connect to your organisation’s network. When travelling, connect to the VPN supplied by your IT team first.' },
    { title: 'Choose browser or Windows', text: 'Approved accounts receive a workspace link and, when released, a Windows installer. Both connect to the same organisation-hosted service.' },
    { title: 'Check your devices and join', text: 'Sign in to your organisation’s workspace, check your camera and microphone, then join an authorised meeting. Your administrator manages access.' },
    { title: 'Work together', text: 'Meet with video, chat and screen sharing. Use available whiteboard, polls, Q&A and notes. Language features depend on your organisation’s configuration.' },
];
export default function IntranetPage() {
    const session = useSession();
    const token = session.profile ? getToken() : '';
    const [result, setResult] = useState<{ token: string; access?: { workspaceUrl: string; windowsAvailable: boolean; onlineDemo: boolean }; error?: string }>();
    const [attempt, setAttempt] = useState(0);
    const current = token && result?.token === token ? result : undefined;
    const access = session.status === 'unavailable' ? undefined : current?.access;
    const loading = !current && (session.status === 'checking' || session.status === 'authenticated');
    const error = session.status === 'unavailable' ? 'We couldn’t check your account. Try again.' : current?.error;
    const downloadRequest = useRef<AbortController | null>(null);
    const downloadOwner = useRef('');
    const [step, setStep] = useState(0);
    const [downloadState, setDownloadState] = useState<DownloadState>({ phase: 'idle' });
    const downloading = downloadState.phase === 'working';
    // Success and failure messages fade on their own; Esc dismisses them sooner.
    useEffect(() => {
        if (downloadState.phase !== 'done' && downloadState.phase !== 'error') return;
        const timer = window.setTimeout(() => setDownloadState({ phase: 'idle' }), downloadState.phase === 'done' ? 15000 : 9000);
        const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setDownloadState({ phase: 'idle' }); };
        window.addEventListener('keydown', onKey);
        return () => { window.clearTimeout(timer); window.removeEventListener('keydown', onKey); };
    }, [downloadState.phase]);
    useEffect(() => {
        setDownloadState({ phase: 'idle' });
        return () => {
            downloadRequest.current?.abort();
            downloadRequest.current = null;
        };
    }, [token]);
    useEffect(() => {
        if (!token || session.status !== 'authenticated') return;
        const controller = new AbortController();
        const currentRequest = () => !controller.signal.aborted && getToken() === token;
        setResult(undefined);
        fetch(`${AUTH_API}/api/auth/enterprise`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        }).then(async response => {
            if (!currentRequest()) return;
            if (response.status === 401) { clearSession(token); return; }
            if (response.status === 403) { setResult({ token }); return; }
            if (!response.ok) throw new Error('Access check failed');
            const data = await response.json();
            const onlineDemo = data.workspaceMode === 'online-demo' && session.profile?.role === 'admin';
            const url = intranetUrl(data.workspaceUrl, window.location.origin, onlineDemo);
            if (!currentRequest()) return;
            setResult(url
                ? { token, access: { workspaceUrl: url, windowsAvailable: data.windowsAvailable === true, onlineDemo } }
                : { token, error: 'The configured address does not point to a separate HTTPS workspace. Ask your administrator to update it.' });
        }).catch(() => {
            if (currentRequest()) setResult({ token, error: 'We couldn’t check your intranet access. Try again.' });
        });
        return () => controller.abort();
    }, [token, attempt, session.status]);
    async function download() {
        if (session.status !== 'authenticated' || !token || !access?.windowsAvailable || downloadRequest.current) return;
        const controller = new AbortController();
        downloadRequest.current = controller;
        downloadOwner.current = token;
        const isCurrent = () => !controller.signal.aborted && getToken() === token;
        setDownloadState({ phase: 'working', received: 0, total: null });
        try {
            const response = await fetch(`${AUTH_API}/api/auth/enterprise/windows`, {
                headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
            });
            if (!isCurrent()) return;
            if (response.status === 401) { clearSession(token); return; }
            if (response.status === 403) {
                setResult({ token });
                throw new Error('Your account no longer has intranet access. Contact your administrator.');
            }
            if (!response.ok) throw new Error('The installer is unavailable. Try again or contact your administrator.');
            const total = Number(response.headers.get('Content-Length')) || null;
            // Stream the body so the message can show real progress.
            const chunks: Uint8Array[] = [];
            let received = 0;
            const reader = response.body?.getReader();
            if (reader) {
                for (;;) {
                    const { done, value } = await reader.read();
                    if (!isCurrent()) { await reader.cancel(); return; }
                    if (done) break;
                    chunks.push(value); received += value.byteLength;
                    setDownloadState({ phase: 'working', received, total });
                }
            } else {
                const buffer = new Uint8Array(await response.arrayBuffer());
                chunks.push(buffer); received = buffer.byteLength;
            }
            if (!received || (total && received !== total)) throw new Error('The download was incomplete. Check your connection and retry.');
            const blob = new Blob(chunks as BlobPart[], { type: 'application/vnd.microsoft.portable-executable' });
            const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
            if (!isCurrent()) return;
            const checksum = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a'); link.href = url; link.download = 'QS-VC-Windows-Setup.exe'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
            setDownloadState({ phase: 'done', checksum, size: received });
        } catch (reason) {
            if (isCurrent()) setDownloadState({ phase: 'error', message: reason instanceof Error ? reason.message : 'Download failed. Please retry.' });
        } finally {
            if (downloadRequest.current === controller) downloadRequest.current = null;
        }
    }
    return <div className="public-site"><SiteNav /><main className="public-container service-page intranet-page" id="main-content">
        <header className="public-page-intro"><h1>{access?.onlineDemo ? 'Your online test workspace.' : access ? 'Your enterprise workspace.' : 'Meet inside your organisation.'}</h1><p>{access?.onlineDemo ? 'Open the shared QS-VC app to try your admin experience online.' : access ? 'Choose how you connect to your approved workspace.' : 'Explore the intranet experience before your organisation gets access.'}</p></header>
        {loading ? <p role="status">Checking enterprise access…</p> : error ? <section className="service-card"><p role="alert">{error}</p><button className="qsvc-action" type="button" onClick={() => {
            if (session.status === 'unavailable') void refreshSession();
            else { setResult(undefined); setAttempt(value => value + 1); }
        }}><ActionContents>Try again</ActionContents></button></section> : access ? <div className="intranet-layout">
            <section className="service-card"><span className="enterprise-access-badge">{access.onlineDemo ? 'Admin · Online test workspace' : 'Approved enterprise access'}</span><h2>Open in your browser</h2><p>{access.onlineDemo ? 'This opens the shared QS-VC online app for testing. It is not an isolated organisation deployment.' : 'Connect to your office network or approved VPN, then sign in to your organisation’s workspace.'}</p><p className="enterprise-address">{access.workspaceUrl}</p><a className="qsvc-action" href={access.workspaceUrl} rel="noreferrer"><ActionContents>Open workspace</ActionContents></a></section>
            <section className="service-card"><h2>QS-VC for Windows</h2><p>{access.onlineDemo ? 'Download the Windows app and use the same online test workspace.' : 'Access the same organisation workspace from the Windows desktop client. Your office network or VPN is still required.'}</p><button className="qsvc-action intranet-download" type="button" aria-busy={downloading} disabled={!access.windowsAvailable || downloading || session.status !== 'authenticated'} onClick={download}><ActionContents><span className="mi" aria-hidden="true">download</span>{downloading ? 'Downloading…' : 'Download for Windows'}</ActionContents></button>{!access.windowsAvailable && <p role="status">Your Windows installer has not been released yet.</p>}<p>{access.onlineDemo ? 'For an isolated enterprise workspace, use the address supplied by your organisation.' : 'After installation, use the organisation address above.'} A download does not grant additional meeting permissions.</p></section>
        </div> : <><div className="intranet-layout"><section className="service-card"><span className="enterprise-access-badge">Guided demo · No live connection</span><h2>See what to expect</h2><MeetingScene /><p>This preview uses sample participants. It does not start your camera, microphone or a meeting.</p></section><section className="service-card"><div className="intranet-guide-tabs" aria-label="Guide steps">{steps.map((item, index) => <button type="button" key={item.title} aria-pressed={step === index} onClick={() => setStep(index)}>{index + 1}<span className="sr-only"> {item.title}</span></button>)}</div><div aria-live="polite"><h2>{steps[step].title}</h2><p>{steps[step].text}</p></div><div className="intranet-guide-controls"><button type="button" disabled={step === 0} onClick={() => setStep(value => value - 1)}>Back</button><button type="button" disabled={step === steps.length - 1} onClick={() => setStep(value => value + 1)}>Next</button></div><p>Ask your administrator which features are enabled in your workspace. Offline captions and translated speech require locally available recognition, translation and voices. Poly room-device access requires a configured gateway and compatibility testing for your devices. Remote access requires your organisation’s approved network connection.</p><Link className="qsvc-action" to="/contact?interest=Intranet"><ActionContents>Request access</ActionContents></Link>{session.status === 'anonymous' ? <p><Link to="/login?next=%2Fintranet">Sign in to check access</Link></p> : <p>Your account does not have intranet access. Ask your administrator to approve it.</p>}</section></div></>}
    </main><SiteFooter /><DownloadFeedback state={token && downloadOwner.current === token ? downloadState : { phase: 'idle' }} onDismiss={() => setDownloadState({ phase: 'idle' })} /></div>;
}
