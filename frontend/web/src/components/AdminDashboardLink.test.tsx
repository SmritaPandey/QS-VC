import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import AdminDashboardLink from './AdminDashboardLink';

const { currentSession } = vi.hoisted(() => ({ currentSession: vi.fn() }));
vi.mock('../lib/use-session', () => ({ useSession: currentSession }));

it.each([
    ['authenticated', true, true],
    ['authenticated', false, false],
    ['authenticated', undefined, false],
    ['anonymous', true, false],
    ['checking', true, false],
    ['unavailable', true, false],
])('shows the shortcut only for a verified approved admin (%s, %s)', (status, approved, visible) => {
    currentSession.mockReturnValue({ status, profile: { role: 'admin', isPlatformAdmin: approved } });
    const html = renderToStaticMarkup(<MemoryRouter><AdminDashboardLink /></MemoryRouter>);
    if (visible) { expect(html).toContain('href="/admin"'); expect(html).toContain('Admin dashboard'); }
    else expect(html).toBe('');
});
