import { meetingJoinPath } from '../lib/meeting-join-path';
import { useSession } from '../lib/use-session';
import ActionContents from '../components/ActionContents';
import SiteNav from '../components/SiteNav';
import SignedInWorkspace from '../components/SignedInWorkspace';
import SiteFooter from '../components/SiteFooter';
import { clearSession, getToken, signOut, refreshSession } from '../lib/session';
import MeetingSetupDialog, { type MeetingSetup } from '../components/MeetingSetupDialog';
import { rememberGuestHost } from '../lib/session-schedule';
import { authenticatedMeetingRequest, meetingsEndpoint } from '../lib/meeting-creation';
import { shareMeetingInvite } from '../lib/meeting-sharing';
import { QRCodeSVG } from 'qrcode.react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import '../styles/account-workspace.css';

const MEETING_API = import.meta.env.VITE_MEETING_URL || import.meta.env.VITE_API_URL || '';
const MEETINGS_ENDPOINT = meetingsEndpoint(MEETING_API);

export default function Landing() {
    const session = useSession();
    const signedIn = session.status === 'authenticated' || Boolean(session.profile);
    const [sessionError, setSessionError] = useState('');
    const [signingOut, setSigningOut] = useState(false);
    const [joinCode, setJoinCode] = useState('');
    const [creating, setCreating] = useState(false);
    const [guestSetupOpen, setGuestSetupOpen] = useState(false);
    const [shareLink, setShareLink] = useState('');
    const [shareMeetingCode, setShareMeetingCode] = useState('');
    const [copyError, setCopyError] = useState('');
    const [shareStatus, setShareStatus] = useState('');
    const [shareBusy, setShareBusy] = useState(false);
    const [copied, setCopied] = useState(false);
    const navigate = useNavigate();
    const shareDialogRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!shareLink) return;
        const returnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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

    const handleCreate = async (setup: MeetingSetup) => {
        setCreating(true);
        try {
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
            const inviteToken = typeof data.inviteToken === 'string' ? data.inviteToken : undefined;
            const inviteQuery = inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : '';
            const previewPath = `/meeting/${code}/preview${inviteQuery}`;
            if (setup.startNow) { navigate(previewPath); return; }
            setShareMeetingCode(code);
            setShareLink(`${window.location.origin}${previewPath}`);
        } finally {
            setCreating(false);
        }
    };

    const startGuestMeeting = async (setup: MeetingSetup) => {
        setCreating(true);
        try {
            const response = await fetch(`${MEETINGS_ENDPOINT}/create`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: setup.title, settings: { meetingKind: setup.meetingKind === 'conference' ? undefined : setup.meetingKind } }),
            });
            if (!response.ok) throw new Error('Could not start a guest meeting.');
            const { meetingCode, inviteToken, guestHostToken } = await response.json();
            if (!meetingCode || !inviteToken || !guestHostToken) throw new Error('The guest meeting could not be opened.');
            rememberGuestHost(meetingCode, guestHostToken);
            navigate(`/meeting/${encodeURIComponent(meetingCode)}/preview?invite=${encodeURIComponent(inviteToken)}`);
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
        const target = meetingJoinPath(joinCode, window.location.origin);
        if (!target) { setSessionError('Enter a meeting code or the full invitation link from this website.'); return; }
        setSessionError('');
        navigate(target);
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
                    <p className="landing-subtitle">Join a meeting, or host an instant or team meeting as a guest.</p>
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
                        <h2>Host a meeting</h2>
                        <p>Start an instant or team meeting, or schedule one up to three days ahead.</p>
                        <button type="button" className="btn-primary qsvc-action" onClick={() => setGuestSetupOpen(true)}><ActionContents>
                            <span className="mi mi-sm" aria-hidden="true">videocam</span>
                            Start a meeting
                        </ActionContents></button>
                        <Link className="guest-schedule-link" to="/schedule">Schedule a meeting<span className="mi" aria-hidden="true">arrow_forward</span></Link>
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
            {!signedIn && guestSetupOpen && <MeetingSetupDialog action="start" guest creating={creating}
                onCreate={startGuestMeeting} onClose={() => setGuestSetupOpen(false)} />}
        </div>
    );
}

