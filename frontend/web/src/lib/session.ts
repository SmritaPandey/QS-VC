export const AUTH_API = import.meta.env.VITE_AUTH_URL || '';

export function getToken(): string {
    // Do not keep bearer credentials across browser sessions or inherit legacy tokens.
    localStorage.removeItem('token');
    return sessionStorage.getItem('token') || '';
}

export function clearSession(): void {
    sessionStorage.removeItem('token');
    localStorage.removeItem('token');
}

export async function signOut(): Promise<void> {
    const token = getToken();
    if (!token) { clearSession(); return; }
    const response = await fetch(`${AUTH_API}/api/auth/logout`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok && response.status !== 401) {
        throw new Error('Sign out could not finish. Check your connection and try again.');
    }
    clearSession();
}

/** Where to go after signing in: an in-app path from ?next=, otherwise the meetings app. Never an external URL. */
export function nextPath(search: string, fallback = '/app'): string {
    const next = new URLSearchParams(search).get('next') || '';
    return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : fallback;
}
