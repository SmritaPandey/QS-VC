import { beforeEach, expect, it, vi } from 'vitest';
import { isValidElement, type ReactNode, type ReactElement } from 'react';
import WebinarsPage, { emptyWebinar } from './WebinarsPage';
const hooks = vi.hoisted(() => ({ values: [] as unknown[], setters: [] as ReturnType<typeof vi.fn>[] }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useEffect: vi.fn(), useState: () => [hooks.values.shift(), hooks.setters.shift()] }));
vi.mock('../lib/use-session', () => ({ useSession: () => ({ status: 'authenticated', profile: { id: 'owner' } }) }));
vi.mock('../lib/session', () => ({ getToken: () => 'verified-token' }));
vi.mock('../components/SiteNav', () => ({ default: () => null }));
vi.mock('../components/SiteFooter', () => ({ default: () => null }));
beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup(offset = 100, nextOffset: number | null = 200, busy = false) {
    const form = { ...emptyWebinar, id: 'webinar', registrationOffset: offset, nextOffset,
        registrations: [{ id: 'registration', name: 'Applicant', email: 'a@example.com', answers: {}, status: 'pending', createdAt: '' }] };
    const setters = Array.from({ length: 9 }, () => vi.fn());
    hooks.values = [[], [], form, busy, false, false, '', '']; hooks.setters = [...setters];
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => form }); vi.stubGlobal('fetch', fetch);
    const tree = WebinarsPage();
    const elements: ReactElement<any>[] = [];
    function visit(node: ReactNode) { if (Array.isArray(node)) node.forEach(visit); else if (isValidElement(node)) { elements.push(node); visit((node.props as any).children); } }
    visit(tree);
    const button = (label: string) => elements.find(element => element.type === 'button' && element.props.children === label)!;
    return { fetch, button, setForm: setters[2] };
}
it.each([['Next', 200], ['Previous', 0], ['Refresh registrations', 100]])('loads the correct bounded page for %s', async (label, offset) => {
    const ctx = setup(); ctx.button(label).props.onClick();
    await vi.waitFor(() => expect(ctx.setForm).toHaveBeenCalled());
    expect(ctx.fetch).toHaveBeenCalledWith(expect.stringContaining(`/webinar?limit=100&offset=${offset}`), expect.any(Object));
});
it('keeps approval refresh on the current registration page', async () => {
    const ctx = setup(1100, 1200); ctx.button('Approve').props.onClick();
    await vi.waitFor(() => expect(ctx.setForm).toHaveBeenCalled());
    expect(ctx.fetch).toHaveBeenNthCalledWith(1, expect.stringContaining('/webinar/registrations/registration'), expect.objectContaining({ method: 'PATCH' }));
    expect(ctx.fetch).toHaveBeenNthCalledWith(2, expect.stringContaining('/webinar?limit=100&offset=1100'), expect.any(Object));
});
it('disables boundary controls and disables page changes during approval', () => {
    const first = setup(0, null); expect(first.button('Previous').props.disabled).toBe(true); expect(first.button('Next').props.disabled).toBe(true);
    const approving = setup(100, 200, true); expect(approving.button('Previous').props.disabled).toBe(true); expect(approving.button('Next').props.disabled).toBe(true);
});
