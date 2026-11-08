export const AUTH_API = import.meta.env.VITE_AUTH_URL || '';

type Profile = { id: string; displayName: string; email: string; phoneNumber?: string | null; role?: string };
export type SessionState = { status: 'checking' | 'authenticated' | 'anonymous' | 'unavailable'; profile?: Profile };
const serverState: SessionState = { status: 'checking' };
let state: SessionState = serverState;
const listeners = new Set<() => void>();
let generation = 0;
let intent = 0;
let pending: { token: string; promise: Promise<void> } | undefined;
let channel: BroadcastChannel | undefined;

export function getToken(): string {
    try {
        const local = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
        if (local) return local;
    } catch { }
    try {
        const session = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('token') : null;
        if (session) return session;
    } catch { }
    return '';
}
function publish(next: SessionState) { state = next; listeners.forEach(listener => listener()); }
export const getSessionState = () => state;
export const getServerSessionState = () => serverState;

export function setSessionToken(token: string): void {
    intent++;
    try { localStorage.setItem('token', token); } catch { }
    try { sessionStorage.setItem('token', token); } catch { }
    generation++; pending = undefined;
    publish({ status: 'checking' });
    channel?.postMessage('revalidate');
    void refreshSession();
}

/** Server invalidation can accompany successful session rotation; only newer user intent cancels login. */
export function beginSignIn(): (token: string) => boolean {
    const requestedIntent = ++intent;
    return token => {
        if (intent !== requestedIntent) return false;
        setSessionToken(token);
        return true;
    };
}

/** A response for an older credential must never clear a newer login. */
export function clearSession(expectedToken?: string): boolean {
    if (expectedToken === undefined) { intent++; expectedToken = getToken(); }
    if (getToken() !== expectedToken) return false;
    try { localStorage.removeItem('token'); } catch { }
    try { sessionStorage.removeItem('token'); } catch { }
    generation++; pending = undefined;
    publish({ status: 'anonymous' });
    return true;
}

export function refreshSession(): Promise<void> {
    const token = getToken();
    if (!token) { publish({ status: 'anonymous' }); return Promise.resolve(); }
    if (pending?.token === token) return pending.promise;
    const currentGeneration = generation;
    const current = () => generation === currentGeneration && getToken() === token;
    publish({ status: 'checking', profile: state.profile });
    const request = { token, promise: Promise.resolve() };
    request.promise = (async () => {
        try {
            const response = await fetch(`${AUTH_API}/api/auth/me`, {
                headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000),
            });
            if (!current()) return;
            if (response.status === 401) { clearSession(token); return; }
            if (!response.ok) throw new Error('Account unavailable');
            const profile = await response.json();
            if (typeof profile.id !== 'string' || typeof profile.displayName !== 'string' || typeof profile.email !== 'string') throw new Error('Invalid account response');
            if (current()) publish({ status: 'authenticated', profile });
        } catch {
            if (current()) publish({ status: 'unavailable', profile: state.profile });
        } finally { if (pending === request) pending = undefined; }
    })();
    pending = request;
    return request.promise;
}

const revalidate = () => { void refreshSession(); };

const handleMessage = (event: MessageEvent | any) => {
    const data = typeof event === 'object' && event !== null && 'data' in event ? event.data : event;
    if (data === 'logout' || (typeof data === 'object' && data?.type === 'logout')) {
        clearSession();
        return;
    }
    void refreshSession();
};

const handleStorage = (event: StorageEvent) => {
    if (event.key === 'token') {
        if (!event.newValue) {
            clearSession();
        } else {
            void refreshSession();
        }
    }
};

export function subscribeSession(listener: () => void): () => void {
    listeners.add(listener);
    if (listeners.size === 1 && typeof window !== 'undefined') {
        window.addEventListener('focus', revalidate);
        window.addEventListener('pageshow', revalidate);
        window.addEventListener('storage', handleStorage);
        // Multi-tab session synchronization: all tabs maintain a shared authenticated session.
        if (typeof BroadcastChannel !== 'undefined') {
            channel = new BroadcastChannel('qsvc-session');
            channel.onmessage = handleMessage;
        }
        revalidate();
    }
    return () => {
        listeners.delete(listener);
        if (!listeners.size && typeof window !== 'undefined') {
            window.removeEventListener('focus', revalidate);
            window.removeEventListener('pageshow', revalidate);
            window.removeEventListener('storage', handleStorage);
            channel?.close(); channel = undefined;
        }
    };
}

export async function signOut(): Promise<void> {
    intent++;
    const token = getToken();
    if (!token) { clearSession(); channel?.postMessage('logout'); return; }
    const response = await fetch(`${AUTH_API}/api/auth/logout`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000),
    });
    if (!response.ok && response.status !== 401) {
        throw new Error('Sign out could not finish. Check your connection and try again.');
    }
    if (clearSession(token)) {
        channel?.postMessage('logout');
    }
}

/** Where to go after signing in: an in-app path from ?next=, otherwise the meetings app. Never an external URL. */
export function nextPath(search: string, fallback = '/app'): string {
    const next = new URLSearchParams(search).get('next') || '';
    return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : fallback;
}
