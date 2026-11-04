import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, getToken, signOut } from './session';
const stored = () => { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) || null, setItem: (key: string, value: string) => map.set(key, value), removeItem: (key: string) => map.delete(key) }; };
beforeEach(() => { vi.stubGlobal('localStorage', stored()); vi.stubGlobal('sessionStorage', stored()); vi.stubGlobal('fetch', vi.fn()); });
it('discards legacy persistent credentials', () => { localStorage.setItem('token', 'legacy'); expect(getToken()).toBe(''); expect(localStorage.getItem('token')).toBeNull(); });
it('revokes the active session before clearing its credential', async () => { sessionStorage.setItem('token', 'demo'); vi.mocked(fetch).mockResolvedValue({ ok: true } as Response); await signOut(); expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/auth/logout'), expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer demo' } })); expect(getToken()).toBe(''); });
it('keeps the session available to retry failed server logout', async () => { sessionStorage.setItem('token', 'demo'); vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as Response); await expect(signOut()).rejects.toThrow('Sign out could not finish'); expect(getToken()).toBe('demo'); clearSession(); expect(getToken()).toBe(''); });

describe('nextPath after sign-in', () => {
    it('returns an in-app path from ?next= and falls back to /app', async () => {
        const { nextPath } = await import('./session');
        expect(nextPath('?next=%2Fschedule')).toBe('/schedule');
        expect(nextPath('')).toBe('/app');
        expect(nextPath('?next=https://evil.example')).toBe('/app');
        expect(nextPath('?next=//evil.example')).toBe('/app');
        expect(nextPath('?next=/\\evil.example')).toBe('/app');
    });
});

const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const accountResponse = (id: string) => ({ ok: true, status: 200, json: async () => ({ id, email: `${id}@example.test`, displayName: id }) }) as Response;

describe('shared account validation', () => {
    beforeEach(() => clearSession());
    it('keeps the credential through server and network outages without calling it authenticated', async () => {
        const { refreshSession, getSessionState } = await import('./session');
        sessionStorage.setItem('token', 'available-later');
        vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as Response);
        await refreshSession();
        expect(getToken()).toBe('available-later');
        expect(getSessionState().status).toBe('unavailable');
        vi.mocked(fetch).mockRejectedValue(new TypeError('Offline'));
        await refreshSession();
        expect(getToken()).toBe('available-later');
        expect(getSessionState().status).toBe('unavailable');
    });
    it('requires a valid account response and clears only a confirmed invalid session', async () => {
        const { refreshSession, getSessionState } = await import('./session');
        sessionStorage.setItem('token', 'demo');
        vi.mocked(fetch).mockResolvedValue(accountResponse('member'));
        await refreshSession();
        expect(getSessionState()).toMatchObject({ status: 'authenticated', profile: { id: 'member' } });
        vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401 } as Response);
        await refreshSession();
        expect(getToken()).toBe('');
        expect(getSessionState()).toEqual({ status: 'anonymous' });
    });
    it('ignores a late 401 from the previous credential and shares pending checks', async () => {
        const { refreshSession, setSessionToken, getSessionState } = await import('./session');
        const old = deferred<Response>();
        vi.mocked(fetch).mockReturnValueOnce(old.promise).mockResolvedValue(accountResponse('new-member'));
        sessionStorage.setItem('token', 'old');
        const pending = refreshSession();
        expect(refreshSession()).toBe(pending);
        setSessionToken('new');
        await refreshSession();
        old.resolve({ ok: false, status: 401 } as Response);
        await pending;
        expect(getToken()).toBe('new');
        expect(getSessionState()).toMatchObject({ status: 'authenticated', profile: { id: 'new-member' } });
        expect(clearSession('old')).toBe(false);
    });
    it('does not erase a replacement login when the old logout completes', async () => {
        const { setSessionToken, refreshSession } = await import('./session');
        const old = deferred<Response>();
        sessionStorage.setItem('token', 'old');
        vi.mocked(fetch).mockReturnValueOnce(old.promise).mockResolvedValue(accountResponse('new-member'));
        const logout = signOut();
        setSessionToken('new');
        await refreshSession();
        old.resolve({ ok: true, status: 200 } as Response);
        await logout;
        expect(getToken()).toBe('new');
    });
    it('revalidates restored pages and focus once, then removes listeners after the last subscriber', async () => {
        const { subscribeSession, refreshSession } = await import('./session');
        const browser = new EventTarget();
        vi.stubGlobal('window', browser);
        vi.stubGlobal('BroadcastChannel', undefined);
        sessionStorage.setItem('token', 'member');
        vi.mocked(fetch).mockResolvedValue(accountResponse('member'));
        const first = subscribeSession(vi.fn());
        const last = subscribeSession(vi.fn());
        await refreshSession();
        expect(fetch).toHaveBeenCalledOnce();
        first();
        browser.dispatchEvent(new Event('pageshow'));
        await refreshSession();
        expect(fetch).toHaveBeenCalledTimes(2);
        browser.dispatchEvent(new Event('focus'));
        await refreshSession();
        expect(fetch).toHaveBeenCalledTimes(3);
        last();
        browser.dispatchEvent(new Event('focus'));
        expect(fetch).toHaveBeenCalledTimes(3);
        vi.unstubAllGlobals();
    });
});

it('notifies other tabs without credentials and revalidates this tab instead of clearing it blindly', async () => {
    clearSession();
    const { subscribeSession, setSessionToken, refreshSession } = await import('./session');
    let broadcast!: { onmessage?: () => void; postMessage: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
    class Channel {
        onmessage?: () => void;
        postMessage = vi.fn(); close = vi.fn();
        constructor() { broadcast = this; }
    }
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('BroadcastChannel', Channel);
    vi.mocked(fetch).mockResolvedValue(accountResponse('member'));
    const stop = subscribeSession(vi.fn());
    setSessionToken('private-credential');
    await refreshSession();
    expect(broadcast.postMessage.mock.calls).toEqual([['revalidate']]);
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as Response);
    broadcast.onmessage?.(); await refreshSession();
    expect(getToken()).toBe('private-credential');
    stop(); expect(broadcast.close).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
});

it('accepts successful login after rotation makes an overlapping old-session check return 401', async () => {
    clearSession();
    const { beginSignIn, refreshSession, getSessionState } = await import('./session');
    const oldCheck = deferred<Response>();
    sessionStorage.setItem('token', 'rotated-old-session');
    vi.mocked(fetch).mockReturnValueOnce(oldCheck.promise).mockResolvedValue(accountResponse('member'));
    const checkingOld = refreshSession();
    const completeSignIn = beginSignIn();
    oldCheck.resolve({ ok: false, status: 401 } as Response);
    await checkingOld;
    expect(getToken()).toBe('');
    expect(completeSignIn('fresh-login')).toBe(true);
    await refreshSession();
    expect(getToken()).toBe('fresh-login');
    expect(getSessionState().status).toBe('authenticated');
});

it('explicit logout supersedes pending login even when server logout fails', async () => {
    clearSession();
    const { beginSignIn } = await import('./session');
    sessionStorage.setItem('token', 'existing');
    const completeSignIn = beginSignIn();
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as Response);
    await expect(signOut()).rejects.toThrow('Sign out could not finish');
    expect(completeSignIn('late-login')).toBe(false);
    expect(getToken()).toBe('existing');
});

it('newer login and explicit local forgetting supersede older pending login', async () => {
    clearSession();
    const { beginSignIn, refreshSession } = await import('./session');
    const oldLogin = beginSignIn();
    const newLogin = beginSignIn();
    vi.mocked(fetch).mockResolvedValue(accountResponse('new-member'));
    expect(oldLogin('old')).toBe(false);
    expect(newLogin('new')).toBe(true);
    await refreshSession();
    const forgottenLogin = beginSignIn();
    clearSession();
    expect(forgottenLogin('late')).toBe(false);
    expect(getToken()).toBe('');
});

it('lets a newer login complete after an earlier logout response clears its old credential', async () => {
    clearSession();
    const { beginSignIn, refreshSession } = await import('./session');
    const logoutResult = deferred<Response>();
    sessionStorage.setItem('token', 'old');
    vi.mocked(fetch).mockReturnValueOnce(logoutResult.promise).mockResolvedValue(accountResponse('member'));
    const logout = signOut();
    const completeSignIn = beginSignIn();
    logoutResult.resolve({ ok: true, status: 200 } as Response);
    await logout;
    expect(getToken()).toBe('');
    expect(completeSignIn('new')).toBe(true);
    await refreshSession();
    expect(getToken()).toBe('new');
});
