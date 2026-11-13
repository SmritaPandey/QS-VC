import { useEffect, useRef, useState } from 'react';
import SiteNav from '../components/SiteNav';
import SiteFooter from '../components/SiteFooter';
import ActionContents from '../components/ActionContents';
import DownloadFeedback, { type DownloadState } from '../components/DownloadFeedback';
import { AUTH_API, clearSession, getToken, refreshSession } from '../lib/session';
import { useSession } from '../lib/use-session';
import { intranetUrl, isOnlineTestWorkspace } from '../lib/intranet-url';
import '../styles/service-pages.css';

const setupGuide = '/guides/QS-VC-Intranet-Setup.pdf';

type DesktopDownload = 'windows' | 'macos-arm64' | 'macos-x64' | 'linux-x64';
type DownloadAvailability = { windows: boolean; macAppleSilicon: boolean; macIntel: boolean; linuxX64: boolean };
const downloadChoices: Array<{ id: DesktopDownload; label: string; availableKey: keyof DownloadAvailability; endpoint: string; filename: string; mime: string }> = [
    { id: 'windows', label: 'Windows 10/11 (64-bit) · ZIP', availableKey: 'windows', endpoint: 'windows', filename: 'QS-VC-Windows-x64.zip', mime: 'application/zip' },
    { id: 'macos-arm64', label: 'Mac · Apple silicon (M1–M4) · ZIP', availableKey: 'macAppleSilicon', endpoint: 'macos/arm64', filename: 'QS-VC-macOS-arm64.zip', mime: 'application/zip' },
    { id: 'macos-x64', label: 'Mac · Intel · ZIP', availableKey: 'macIntel', endpoint: 'macos/x64', filename: 'QS-VC-macOS-x64.zip', mime: 'application/zip' },
    { id: 'linux-x64', label: 'Linux · x64 · ZIP', availableKey: 'linuxX64', endpoint: 'linux/x64', filename: 'QS-VC-Linux-x64.zip', mime: 'application/zip' },
];
export default function IntranetPage() {
    const session = useSession();
    const token = session.profile ? getToken() : '';
    const [result, setResult] = useState<{ token: string; access?: { workspaceUrl: string; downloads: DownloadAvailability; onlineDemo: boolean }; error?: string }>();
    const [attempt, setAttempt] = useState(0);
    const current = token && result?.token === token ? result : undefined;
    const access = session.status === 'unavailable' ? undefined : current?.access;
    const loading = !current && (session.status === 'checking' || session.status === 'authenticated');
    const error = session.status === 'unavailable' ? 'We couldn’t check your account. Try again.' : current?.error;
    const downloadRequest = useRef<AbortController | null>(null);
    const downloadOwner = useRef('');
    const [downloadState, setDownloadState] = useState<DownloadState>({ phase: 'idle' });
    const [downloadPlatform, setDownloadPlatform] = useState<DesktopDownload>('windows');
    const chosenDownload = downloadChoices.find(choice => choice.id === downloadPlatform)!;
    const chosenDownloadAvailable = Boolean(access?.downloads[chosenDownload.availableKey]);
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
            const onlineDemo = session.profile?.role === 'admin'
                && (data.workspaceMode === 'online-demo' || isOnlineTestWorkspace(data.workspaceUrl));
            const url = intranetUrl(data.workspaceUrl, window.location.origin, onlineDemo);
            if (!currentRequest()) return;
            setResult(url
                ? { token, access: {
                    workspaceUrl: url,
                    downloads: {
                        windows: data.downloads?.windows === true || data.windowsAvailable === true,
                        macAppleSilicon: data.downloads?.macAppleSilicon === true,
                        macIntel: data.downloads?.macIntel === true,
                        linuxX64: data.downloads?.linuxX64 === true,
                    },
                    onlineDemo,
                } }
                : { token, error: 'We couldn’t open your workspace. Ask your administrator for the correct link.' });
        }).catch(() => {
            if (currentRequest()) setResult({ token, error: 'We couldn’t check your on-prem access. Try again.' });
        });
        return () => controller.abort();
    }, [token, attempt, session.status]);
    async function download() {
        if (session.status !== 'authenticated' || !token || !chosenDownloadAvailable || downloadRequest.current) return;
        const controller = new AbortController();
        downloadRequest.current = controller;
        downloadOwner.current = token;
        const isCurrent = () => !controller.signal.aborted && getToken() === token;
        setDownloadState({ phase: 'working', received: 0, total: null });
        try {
            const request = (endpoint: string) => fetch(`${AUTH_API}/api/auth/enterprise/${endpoint}`, {
                headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
            });
            let response = await request(chosenDownload.endpoint);
            // Older deployed auth services may expose only /download/:platform.
            // Keep the ZIP flow working during a rolling frontend/backend upgrade.
            if (response.status === 404 && isCurrent()) {
                const legacyPlatform = chosenDownload.id;
                response = await request(`download/${legacyPlatform}`);
            }
            if (!isCurrent()) return;
            if (response.status === 401) { clearSession(token); return; }
            if (response.status === 403) {
                setResult({ token });
                setDownloadState({ phase: 'error', message: 'Your account no longer has on-prem access. Contact your administrator.' });
                return;
            }
            if (response.status === 404 || response.status === 503) {
                setDownloadState({ phase: 'error', message: 'The app download is unavailable. Try again later or contact your administrator.' });
                return;
            }
            if (!response.ok) throw new Error();
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
            if (!received || (total && received !== total)) {
                setDownloadState({ phase: 'error', message: 'The download was incomplete. Check your connection and try again.' });
                return;
            }
            const blob = new Blob(chunks as BlobPart[], { type: chosenDownload.mime });
            const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
            if (!isCurrent()) return;
            const checksum = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a'); link.href = url; link.download = chosenDownload.filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
            setDownloadState({ phase: 'done', checksum, size: received, archive: chosenDownload.id.startsWith('macos-') ? 'macos' : chosenDownload.id === 'linux-x64' ? 'linux' : 'windows' });
        } catch {
            if (isCurrent()) setDownloadState({ phase: 'error', message: 'We couldn’t download the app. Please try again.' });
        } finally {
            if (downloadRequest.current === controller) downloadRequest.current = null;
        }
    }
    return <div className="public-site"><SiteNav brandName="QS-Enterprise" /><main className="public-container service-page intranet-page" id="main-content">
        <header className="public-page-intro"><h1>{access?.onlineDemo ? 'Your online test workspace.' : access ? 'Your QS-Enterprise workspace.' : 'Meet inside your organisation.'}</h1><p>{access?.onlineDemo ? 'Open the shared QS-VC app to try your admin experience online.' : access ? 'Choose how you connect to your approved workspace.' : 'Set up QS-VC on your organisation’s Linux server.'}</p></header>
        <section className="service-card" aria-labelledby="onprem-installer-title">
            <h2 id="onprem-installer-title">QS-VC On-prem installer</h2>
            <p>Your 14 days of free use start at installation. When they end, the workspace shows how to contact us for an extension.</p>
            <div className="onprem-installer-actions">
                <a className="qsvc-action" href={AUTH_API + '/api/auth/enterprise/trial-package'}>
                    <ActionContents><span className="mi" aria-hidden="true">download</span>Download installer</ActionContents>
                </a>
                <a className="qsvc-action qsvc-action--secondary" href={setupGuide} target="_blank" rel="noreferrer">
                    <ActionContents><span className="mi" aria-hidden="true">picture_as_pdf</span>Read setup guide</ActionContents>
                    <span className="sr-only"> (PDF, opens in a new tab)</span>
                </a>
            </div>
        </section>
        <section className="service-card onprem-devices" aria-labelledby="onprem-devices-title">
            <h2 id="onprem-devices-title">Join from your device</h2>
            <p>Open the workspace address from your IT team in a browser on Windows, macOS, Linux, iPhone, iPad or Android.</p>
            <p>Approved workspace accounts can also download the desktop app for Windows x64, macOS (Apple silicon or Intel), or Linux x64.</p>
        </section>
        {loading ? <p role="status">Checking QS-Enterprise access…</p> : error ? <section className="service-card"><p role="alert">{error}</p><button className="qsvc-action" type="button" onClick={() => {
            if (session.status === 'unavailable') void refreshSession();
            else { setResult(undefined); setAttempt(value => value + 1); }
        }}><ActionContents>Try again</ActionContents></button></section> : access ? <div className="intranet-layout">
            <section className="service-card"><span className="enterprise-access-badge">{access.onlineDemo ? 'Admin · Online test workspace' : 'Approved QS-Enterprise access'}</span><h2>Open in your browser</h2><p>{access.onlineDemo ? 'This opens the shared QS-VC online app to test the QS-Enterprise experience. It is not an isolated organisation deployment.' : 'Connect to your office network or approved VPN, then sign in to your organisation’s workspace.'}</p><p className="enterprise-address">{access.workspaceUrl}</p><a className="qsvc-action" href={access.workspaceUrl} rel="noreferrer"><ActionContents>Open workspace</ActionContents></a></section>
            <section className="service-card"><h2>Download QS-VC</h2><p>{access.onlineDemo ? 'Choose your computer and use the same online test workspace.' : 'Choose the app for your computer. The app connects to the organisation workspace above.'}</p><p>On Mac, extract the ZIP and move QS-VC.app to Applications. On Windows, extract the ZIP and run QS-VC.exe from the extracted folder. On Linux x64, extract the ZIP and run qs-vc from the extracted folder. Ask your administrator if you need help with your Linux distribution.</p><label className="intranet-platform-label" htmlFor="intranet-download-platform">Your device</label><select id="intranet-download-platform" value={downloadPlatform} disabled={downloading} onChange={event => setDownloadPlatform(event.target.value as DesktopDownload)}>{downloadChoices.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select><button className="qsvc-action intranet-download" type="button" aria-busy={downloading} disabled={!chosenDownloadAvailable || downloading || session.status !== 'authenticated'} onClick={download}><ActionContents><span className="mi" aria-hidden="true">download</span>{downloading ? 'Downloading…' : downloadPlatform === 'linux-x64' ? 'Download Linux ZIP' : downloadPlatform.startsWith('macos-') ? 'Download Mac ZIP' : 'Download Windows ZIP'}</ActionContents></button>{!chosenDownloadAvailable && <p role="status">This app archive is not available yet. Choose another device or contact your administrator.</p>}<p>{access.onlineDemo ? 'For an isolated enterprise workspace, use the address supplied by your organisation.' : 'After installation, use the organisation address above.'} A download does not grant additional meeting permissions.</p><p>Each ZIP includes the getting-started guide, the prerequisites and the on-prem setup guide for IT. <a href="/guides/QS-VC-Prerequisites.pdf" target="_blank" rel="noreferrer">Prerequisites (PDF)</a> · <a href="/guides/QS-VC-Getting-Started.pdf" target="_blank" rel="noreferrer">Getting started (PDF)</a> · <a href="/guides/QS-VC-Intranet-Setup.pdf" target="_blank" rel="noreferrer">On-prem setup (PDF)</a></p></section>
        </div> : null}
    </main><SiteFooter /><DownloadFeedback state={token && downloadOwner.current === token ? downloadState : { phase: 'idle' }} onDismiss={() => setDownloadState({ phase: 'idle' })} /></div>;
}
