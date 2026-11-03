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
