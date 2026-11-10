import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lifecycle = vi.hoisted(() => ({ effects: [] as Array<() => () => void>, updates: [] as unknown[] }));
vi.mock('react', () => ({
    useCallback: (callback: unknown) => callback,
    useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, (next: unknown) => lifecycle.updates.push(next)],
    useEffect: (effect: () => () => void) => lifecycle.effects.push(effect),
}));

const DAY = 24 * 60 * 60 * 1000;
const KEY = 'qsvc:currency-rates:inr:v1';
const quoteRows = [
    { base: 'INR', quote: 'USD', rate: 0.012, date: '2026-11-10' },
    { base: 'INR', quote: 'EUR', rate: 0.011, date: '2026-11-10' },
];
let useCurrencyRates: typeof import('./currency-rates').useCurrencyRates;
let cleanup: Array<() => void>;
let events: EventTarget;
let storage: Map<string, string>;

beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T10:00:00Z'));
    lifecycle.effects = []; lifecycle.updates = [];
    cleanup = []; events = new EventTarget(); storage = new Map();
    vi.stubGlobal('window', {
        localStorage: { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value) },
        setTimeout, clearTimeout,
        addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(quoteRows)));
    ({ useCurrencyRates } = await import('./currency-rates'));
});

afterEach(() => {
    cleanup.forEach(dispose => dispose());
    vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

function mount() {
    const result = useCurrencyRates();
    cleanup.push(lifecycle.effects.pop()!());
    return result;
}

function savedRates(age: number) {
    storage.set(KEY, JSON.stringify({
        rates: { INR: 1, USD: 0.012, EUR: 0.011 },
        dates: { USD: '2026-11-10', EUR: '2026-11-10' }, date: '2026-11-10', fetchedAt: Date.now() - age,
    }));
}

describe('automatic currency updates', () => {
    it('shares a request across mounts and refreshes an open page at 24 hours', async () => {
        mount(); mount();
        expect(fetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(DAY - 1);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(lifecycle.updates).not.toContain('stale');
        await vi.advanceTimersByTimeAsync(1);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('reuses a fresh cache when moving between pricing and checkout', async () => {
        savedRates(DAY - 1000);
        mount(); mount();
        expect(fetch).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(999);
        expect(fetch).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('refreshes stale rates on focus or reconnect after the clock advances', async () => {
        savedRates(0); mount();
        vi.setSystemTime(Date.now() + DAY);
        events.dispatchEvent(new Event('online'));
        events.dispatchEvent(new Event('focus'));
        await vi.advanceTimersByTimeAsync(0);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(lifecycle.updates).toContain('ready');
    });

    it('retains saved rates after an empty response and limits retries to once per 15 minutes', async () => {
        savedRates(DAY);
        vi.mocked(fetch).mockImplementation(async () => new Response('', { status: 502 }));
        const initial = mount();
        await vi.advanceTimersByTimeAsync(0);
        expect(initial.rates.USD).toBe(0.012);
        expect(lifecycle.updates).toContain('stale');
        for (let index = 0; index < 5; index++) {
            events.dispatchEvent(new Event('focus'));
            events.dispatchEvent(new Event('online'));
        }
        expect(fetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('aborts a stalled update after ten seconds and keeps INR available', async () => {
        vi.mocked(fetch).mockImplementation((_url, options) => new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        }));
        const initial = mount();
        expect(initial.displayCurrency).toBe('INR');
        await vi.advanceTimersByTimeAsync(10_000);
        expect(lifecycle.updates).toContain('error');
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('reuses rates in memory when local storage is unavailable and removes unmounted listeners', async () => {
        window.localStorage.setItem = () => { throw new Error('Storage blocked'); };
        mount();
        await vi.advanceTimersByTimeAsync(0);
        cleanup.pop()!();
        const next = mount();
        expect(next.rates.USD).toBe(0.012);
        expect(fetch).toHaveBeenCalledTimes(1);
        cleanup.pop()!();
        await vi.advanceTimersByTimeAsync(DAY);
        events.dispatchEvent(new Event('focus'));
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
