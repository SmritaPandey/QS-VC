import { useSession } from '../lib/use-session';
import ActionContents from '../components/ActionContents';
import SiteNav from '../components/SiteNav';
import SignedInWorkspace from '../components/SignedInWorkspace';
import SiteFooter from '../components/SiteFooter';
import { clearSession, getToken, signOut, refreshSession } from '../lib/session';
import type { MeetingSetup } from '../components/MeetingSetupDialog';
import { authenticatedMeetingRequest, meetingsEndpoint } from '../lib/meeting-creation';
import LoadingMark from '../components/LoadingMark';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const MEETING_API = import.meta.env.VITE_MEETING_URL || import.meta.env.VITE_API_URL || '';
const MEETINGS_ENDPOINT = meetingsEndpoint(MEETING_API);
const SIGNALING_HTTP = (import.meta.env.VITE_SIGNALING_URL || '')
    .replace(/^wss:/i, 'https:')
    .replace(/^ws:/i, 'http:')
    .replace(/\/ws\/?$/i, '');

function generateMeetingCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const segments = [];
    for (let s = 0; s < 3; s++) {
        let seg = '';
        for (let i = 0; i < 4; i++) {
            seg += chars[Math.floor(Math.random() * chars.length)];
        }
        segments.push(seg);
    }
    return `QS-${segments.join('-')}`;
}

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

    // Room is created on first WebSocket joinRoom — local code unblocks the share UI
    return { meetingCode: generateMeetingCode() };
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

    const handleGoToMeeting = () => {
        navigate(`/meeting/${shareMeetingCode}/preview`);
    };

    const handleJoin = () => {
        const code = joinCode.trim().toUpperCase();
        if (!code) return;
        navigate(`/meeting/${code}/preview`);
    };

    const handleExpired = useCallback(() => { setSessionError('Your session expired. Sign in to see your meetings.'); }, []);
    const handleSignOut = async () => {
        setSigningOut(true); setSessionError('');
        try {
            await signOut();
            navigate('/login', { replace: true, state: { notice: 'You’ve signed out. Sign in again or join a meeting as a guest.' } });
        }
        catch (error) { setSessionError(error instanceof Error ? error.message : 'Sign out failed.'); }
        finally { setSigningOut(false); }
    };

    return (
        <div className={`public-site ${signedIn ? 'workspace-page' : 'public-launcher landing-page'}`}>
            <div className="landing-bg-gradient" />

            {signedIn ? <SignedInWorkspace creating={creating} signingOut={signingOut} sessionError={sessionError} onCreate={handleCreate} onSignOut={handleSignOut} onExpired={handleExpired} /> : <>
            <SiteNav accountAction={<button className="btn-outline qsvc-action qsvc-action--secondary" onClick={() => navigate('/login')}><ActionContents>Sign in</ActionContents></button>} />

            <main className="landing-container" id="main-content">
                {sessionError && <p role="alert">{sessionError}</p>}
                {session.status === 'unavailable' && <p role="status">Account unavailable. <button type="button" onClick={() => void refreshSession()}>Try again</button></p>}
                <p className="demo-notice">Demo environment. Use sample names and content. Sign in as the meeting host to record when cloud storage is configured.</p>
                <div className="landing-hero">

                    <h1>Make room for the conversation.</h1>
                    <p className="landing-subtitle">
                        Create a meeting, invite your participants or join with a code.
                    </p>
                </div>

                <div className="landing-actions">
                    <div className="action-card">
                        <h2>Start a meeting</h2>
                        <p>Create a link, then check your camera and microphone.</p>
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
                        <button
                            className="btn-outline qsvc-action qsvc-action--secondary"
                            onClick={() => navigate('/schedule')}
                            style={{ marginTop: '10px', width: '100%' }}
                        ><ActionContents>
                            <span className="mi mi-sm" aria-hidden="true">calendar_today</span>
                            Schedule a meeting</ActionContents></button>
                    </div>

                    <div className="action-divider">
                        <span>OR</span>
                    </div>

                    <div className="action-card">
                        <h2>Have an invitation?</h2>
                        <p>Enter a meeting code to join</p>
                        <label className="field-label" htmlFor="join-meeting-code">Meeting code</label>
                        <div className="join-input-group">
                            <input
                                type="text"
                                id="join-meeting-code" aria-label="Meeting code" placeholder="QS-XXXX-XXXX-XXXX"
                                value={joinCode}
                                onChange={(e) => setJoinCode(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                                className="input-meeting-code"
                            />
                            <button
                                className="btn-primary qsvc-action"
                                onClick={handleJoin}
                                disabled={!joinCode.trim()}
                                style={{ padding: '12px 24px' }}
                            ><ActionContents>Join</ActionContents></button>
                        </div>
                    </div>
                </div>

                <div className="landing-features"><span className="feature-chip"><span className="mi mi-sm" aria-hidden="true">videocam</span> Video meetings</span><span className="feature-chip"><span className="mi mi-sm" aria-hidden="true">screen_share</span> Screen sharing</span><span className="feature-chip"><span className="mi mi-sm" aria-hidden="true">chat</span> In-meeting conversation</span></div>
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
                        <div className="share-modal-actions">
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

