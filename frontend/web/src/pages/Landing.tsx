import { useSession } from '../lib/use-session';
import ActionContents from '../components/ActionContents';
import SiteNav from '../components/SiteNav';
import SignedInWorkspace from '../components/SignedInWorkspace';
import SiteFooter from '../components/SiteFooter';
import { clearSession, getToken, signOut, refreshSession } from '../lib/session';
import type { MeetingSetup } from '../components/MeetingSetupDialog';
import { authenticatedMeetingRequest, meetingsEndpoint } from '../lib/meeting-creation';
import { shareMeetingInvite } from '../lib/meeting-sharing';
import { QRCodeSVG } from 'qrcode.react';
import LoadingMark from '../components/LoadingMark';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import '../styles/account-workspace.css';

const MEETING_API = import.meta.env.VITE_MEETING_URL || import.meta.env.VITE_API_URL || '';
const MEETINGS_ENDPOINT = meetingsEndpoint(MEETING_API);
const SIGNALING_HTTP = (import.meta.env.VITE_SIGNALING_URL || '')
    .replace(/^wss:/i, 'https:')
    .replace(/^ws:/i, 'http:')
    .replace(/\/ws\/?$/i, '');

async function createMeetingCode(): Promise<{ meetingCode: string; inviteToken?: string }> {
    // Prefer same-origin Vercel serverless (always available in prod), then backends
    const endpoints = [
        '/api/meetings/create',
        `${MEETING_API}/api/meetings/create`,
        `${SIGNALING_HTTP}/api/meetings/create`,
    ].filter((url) => url.startsWith('/') || url.startsWith('http'));

    for (const url of endpoints) {
        try {
            const res = await fetch(url, { method: 'POST' });
            if (!res.ok) continue;
            const data = await res.json();
            if (data?.meetingCode) return {
                meetingCode: data.meetingCode as string,
                inviteToken: typeof data.inviteToken === 'string' ? data.inviteToken : undefined,
            };
        } catch (err) {
            console.warn('Create meeting attempt failed:', url, err);
        }
    }

    // Meeting identifiers are issued by the service so the database can enforce uniqueness.
    throw new Error('Meeting creation is temporarily unavailable. Please try again shortly.');
}

export default function Landing() {
    const session = useSession();
    const signedIn = session.status === 'authenticated' || Boolean(session.profile);
    const [sessionError, setSessionError] = useState('');
    const [signingOut, setSigningOut] = useState(false);
    const [joinCode, setJoinCode] = useState('');
    const [creating, setCreating] = useState(false);
    const [shareLink, setShareLink] = useState('');
    const [shareMeetingCode, setShareMeetingCode] = useState('');
    const [copyError, setCopyError] = useState('');
    const [shareStatus, setShareStatus] = useState('');
    const [shareBusy, setShareBusy] = useState(false);
    const [copied, setCopied] = useState(false);
    const navigate = useNavigate();
    const shareDialogRef = useRef<HTMLDivElement>(null);
    const createButtonRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!shareLink) return;
        const returnTarget = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : createButtonRef.current;
        const dialog = shareDialogRef.current;
        const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input, a[href], [tabindex="0"]') || []);
        focusable()[0]?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { event.preventDefault(); setShareLink(''); }
            if (event.key !== 'Tab') return;
            const items = focusable();
            const first = items[0];
            const last = items[items.length - 1];
            if (!dialog?.contains(document.activeElement)) {
                event.preventDefault();
                (event.shiftKey ? last : first)?.focus();
                return;
            }
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => { document.removeEventListener('keydown', onKeyDown); returnTarget?.focus(); };
    }, [shareLink]);

    const handleCreate = async (setup?: MeetingSetup) => {
        setCreating(true);
        try {
            let meetingCode: string;
            let inviteToken: string | undefined;
            if (setup) {
                const token = getToken();
                if (!token) throw new Error('Your sign-in has expired. Sign in again to create a meeting.');
                const response = await fetch(MEETINGS_ENDPOINT, authenticatedMeetingRequest(token, setup));
                if (getToken() !== token) throw new Error('Your session changed. Please try creating the meeting again.');
                if (response.status === 401) {
                    clearSession(token);
                    setSessionError('Your session expired. Sign in again to create a meeting.');
                    throw new Error('Your session expired. Sign in again to create a meeting.');
                }
                if (!response.ok) {
                    const data = await response.json().catch(() => null);
                    throw new Error(typeof data?.message === 'string' ? data.message : 'Could not create the meeting. Please try again.');
                }
                const data = await response.json();
                const code = data.meetingCode || data.code;
                if (typeof code !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(code)) throw new Error('The meeting service returned an invalid invitation. Please try again.');
                meetingCode = code;
                inviteToken = typeof data.inviteToken === 'string' ? data.inviteToken : undefined;
            } else {
                if (signedIn) throw new Error('Choose a meeting type before creating a meeting.');
                ({ meetingCode, inviteToken } = await createMeetingCode());
            }
            const inviteQuery = inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : '';
            const fullLink = `${window.location.origin}/meeting/${meetingCode}/preview${inviteQuery}`;
            if (setup?.startNow) { navigate(`/meeting/${meetingCode}/preview${inviteQuery}`); return; }
            setShareMeetingCode(meetingCode);
            setShareLink(fullLink);
        } catch (err) {
            console.error('Failed to create meeting:', err);
            if (!setup) alert('Failed to create meeting. Please try again in a moment.');
            else throw err;
        } finally {
            setCreating(false);
        }
    };

    const handleCopy = async () => {
        setCopyError('');
        setShareStatus('');
        try {
            await navigator.clipboard.writeText(shareLink);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Fallback for non-HTTPS contexts
            const ta = document.createElement('textarea');
            ta.value = shareLink;
            document.body.appendChild(ta);
            ta.select();
            try {
                if (!document.execCommand('copy')) throw new Error();
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            } catch { setCopyError('Couldn’t copy. Select and copy the invitation link.'); }
            finally { document.body.removeChild(ta); }
        }
    };

    const handleShareInvite = async () => {
        if (!shareLink || shareBusy) return;
        setShareBusy(true);
        setCopyError('');
        setShareStatus('');
        try {
            const result = await shareMeetingInvite('QS-VC meeting invitation', shareMeetingCode, shareLink);
            setShareStatus(result === 'shared' ? 'Share sheet closed.' : result === 'copied' ? 'Invite link copied.' : 'Sharing canceled.');
        } catch {
            setShareStatus('Could not share the invite link. Copy it and try again.');
        } finally {
            setShareBusy(false);
        }
    };

    const handleGoToMeeting = () => {
        navigate(`/meeting/${shareMeetingCode}/preview`);
    };

    const handleJoin = () => {
        const code = joinCode.trim().toUpperCase();
        if (!code) return;
        navigate(`/meeting/${encodeURIComponent(code)}/preview`);
    };

    const handleExpired = useCallback(() => { setSessionError('Your session expired. Sign in to see your meetings.'); }, []);
    const handleSignOut = async () => {
        setSigningOut(true); setSessionError('');
        try {
            await signOut();
            navigate('/login', { replace: true, state: { notice: 'You’ve signed out. Sign in again or join a meeting as a guest.' } });
        }
        catch { setSessionError('Sign out could not finish. Check your connection and try again.'); }
        finally { setSigningOut(false); }
    };

    return (
        <div className={`public-site ${signedIn ? 'workspace-page' : 'public-launcher landing-page guest-workspace'}`}>
            <div className="landing-bg-gradient" />

            {signedIn ? <SignedInWorkspace creating={creating} signingOut={signingOut} sessionError={sessionError} onCreate={handleCreate} onSignOut={handleSignOut} onExpired={handleExpired} /> : <>
            <SiteNav accountAction={<button className="btn-outline qsvc-action qsvc-action--secondary" onClick={() => navigate('/login')}><ActionContents>Sign in</ActionContents></button>} />

            <main className="landing-container" id="main-content">
                {sessionError && <p role="alert">{sessionError}</p>}
                {session.status === 'unavailable' && <p role="status">Account unavailable. <button type="button" onClick={() => void refreshSession()}>Try again</button></p>}
                <div className="landing-hero">
                    <h1>Guest meetings</h1>
                    <p className="landing-subtitle">Join with a meeting code or create an instant meeting. Sign in to see your plan and scheduled meetings.</p>
                </div>

                <div className="landing-actions">
                    <div className="action-card">
                        <h2>Join a meeting</h2>
                        <p>Enter the code from your invitation.</p>
                        <label className="field-label" htmlFor="join-meeting-code">Meeting code</label>
                        <form className="join-input-group" onSubmit={event => { event.preventDefault(); handleJoin(); }}>
                            <input type="text" id="join-meeting-code" placeholder="QS-XXXX-XXXX-XXXX"
                                value={joinCode} onChange={event => setJoinCode(event.target.value)} className="input-meeting-code" />
                            <button type="submit" className="btn-primary qsvc-action" disabled={!joinCode.trim()}>
                                <ActionContents>Join</ActionContents>
                            </button>
                        </form>
                    </div>

                    <div className="action-card">
                        <h2>Start an instant meeting</h2>
                        <p>Create a link to share with participants.</p>
                        <button
                            className="btn-primary qsvc-action"
                            ref={createButtonRef}
                            onClick={() => handleCreate()}
                            disabled={creating} aria-busy={creating}
                        ><ActionContents>
                            {creating ? (
                                <LoadingMark label="Creating meeting…" />
                            ) : (
                                <>
                                    <span className="mi mi-sm" aria-hidden="true">videocam</span>
                                    Create meeting
                                </>
                            )}</ActionContents></button>
                        <Link className="guest-schedule-link" to="/schedule">Sign in to schedule<span className="mi" aria-hidden="true">arrow_forward</span></Link>
                    </div>
                </div>

            </main>

            </>}

            {/* ── Share Link Modal ── */}
            {shareLink && (
                <div className="share-modal-overlay" onClick={() => setShareLink('')}>
                    <div className="share-modal" ref={shareDialogRef} role="dialog" aria-modal="true" aria-label="Meeting invitation" onClick={(e) => e.stopPropagation()}>
                        <div className="share-modal-icon">
                            <span className="mi" style={{ fontSize: 48, color: 'var(--accent-success)' }}>check_circle</span>
                        </div>
                        <h2>Your meeting link is ready.</h2>
                        <p className="share-modal-code">
                            <span className="mi mi-sm" aria-hidden="true">lock</span> {shareMeetingCode}
                        </p>
                        <p style={{ color: 'var(--text-secondary)', margin: '8px 0 16px' }}>
                            Share this link with participants:
                        </p>
                        <div className="share-modal-qr">
                            <div className="share-modal-qr-image">
                                <QRCodeSVG value={shareLink} size={128} level="M" includeMargin title={`QR code to join meeting ${shareMeetingCode}`} />
                            </div>
                            <p>Scan this code to join with the same invitation.</p>
                        </div>
                        <div className="share-link-box">
                            <input
                                type="text"
                                value={shareLink}
                                readOnly
                                className="share-link-input" aria-label="Meeting invitation link"
                                onClick={(e) => (e.target as HTMLInputElement).select()}
                            />
                            <button className="btn-copy qsvc-action" onClick={handleCopy}><ActionContents><span className="mi mi-sm" aria-hidden="true">{copied ? 'done' : 'content_copy'}</span>
                                {copied ? 'Copied' : 'Copy'}</ActionContents></button>
                        </div>
                        {copyError && <p role="alert">{copyError}</p>}
                        {shareStatus && <p className="share-modal-status" role="status" aria-live="polite">{shareStatus}</p>}
                        <div className="share-modal-actions">
                            <button className="btn-outline qsvc-action qsvc-action--secondary" onClick={() => void handleShareInvite()} disabled={shareBusy} aria-busy={shareBusy}><ActionContents><span className="mi mi-sm" aria-hidden="true">ios_share</span>
                                {shareBusy ? 'Opening share…' : 'Share invite'}</ActionContents></button>
                            <button className="btn-primary btn-lg qsvc-action" onClick={handleGoToMeeting}><ActionContents><span className="mi mi-sm" aria-hidden="true">videocam</span>
                                Check my devices</ActionContents></button>
                            <button className="btn-outline qsvc-action qsvc-action--secondary" onClick={() => setShareLink('')}><ActionContents>
                                Close</ActionContents></button>
                        </div>
                    </div>
                </div>
            )}
            {!signedIn && <SiteFooter />}
        </div>
    );
}

