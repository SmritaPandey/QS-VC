import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const lifecycle = vi.hoisted(() => ({ effects: [] as Array<() => () => void>, updates: [] as unknown[] }));
vi.mock('react', async importOriginal => ({
    ...await importOriginal<typeof import('react')>(),
    useState: (initial: unknown) => [initial, (value: unknown) => lifecycle.updates.push(value)],
    useEffect: (effect: () => () => void) => lifecycle.effects.push(effect),
}));
vi.mock('./use-session', () => ({ useSession: () => ({ status: 'authenticated', profile: { id: 'member', role: 'member' } }) }));
vi.mock('./session', () => ({ AUTH_API: '', getToken: () => 'existing-session' }));
import { EntitlementsProvider } from './entitlements';

let cleanup: () => void;
beforeEach(() => {
    lifecycle.effects = [];
    lifecycle.updates = [];
    vi.stubGlobal('window', new EventTarget());
});
afterEach(() => { cleanup?.(); vi.unstubAllGlobals(); });

it.each(['stale plan', 'late failure'])('keeps confirmed paid access when an older request returns a %s', async outcome => {
    let resolveOld!: (value: Response) => void;
    let rejectOld!: (error: Error) => void;
    const old = new Promise<Response>((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(old).mockResolvedValue(Response.json({
        plan: 'pro', status: 'paid_active', features: ['meeting_scheduling', 'ai_captions', 'cloud_recording'],
    })));
    EntitlementsProvider({ children: null });
    cleanup = lifecycle.effects[1]();
    window.dispatchEvent(new Event('qsvc:entitlements-refresh'));
    await vi.waitFor(() => expect(lifecycle.updates.at(-1)).toMatchObject({ plan: 'pro', verified: true, features: expect.arrayContaining(['cloud_recording']) }));
    if (outcome === 'stale plan') resolveOld(Response.json({ plan: 'guest', status: 'paid_active', features: [] }));
    else rejectOld(new Error('Previous request failed'));
    await old.catch(() => undefined);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(lifecycle.updates.at(-1)).toMatchObject({ plan: 'pro', loading: false });
});

it('distinguishes an unavailable plan check from verified Free access', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Service unavailable')));
    EntitlementsProvider({ children: null });
    cleanup = lifecycle.effects[1]();
    await vi.waitFor(() => expect(lifecycle.updates.at(-1)).toMatchObject({ loading: false, verified: false }));
    vi.mocked(fetch).mockResolvedValue(Response.json({ plan: 'guest', status: 'paid_active', features: [] }));
    window.dispatchEvent(new Event('qsvc:entitlements-refresh'));
    await vi.waitFor(() => expect(lifecycle.updates.at(-1)).toMatchObject({ plan: 'guest', verified: true }));
});
