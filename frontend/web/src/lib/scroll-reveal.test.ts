import { afterEach, expect, it, vi } from 'vitest';
import { watchScrollReveals } from './scroll-reveal';

afterEach(() => vi.unstubAllGlobals());

it('leaves content alone when intersection observation is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = { querySelectorAll: vi.fn() };
    watchScrollReveals(root as unknown as HTMLElement)();
    expect(root.querySelectorAll).not.toHaveBeenCalled();
});

it('observes photos directly, waits for entry, replays after exit and cleans up reduced motion', () => {
    const classes = new Set<string>();
    const photoSelector = '.feature-visual,.home-expression-visual,.home-security-visual,.home-option-visual,.home-upright-example';
    let rect = { top: 1000, bottom: 1300 };
    const node = { closest: (selector: string) => selector === photoSelector ? node : null, matches: (selector: string) => selector === photoSelector, getBoundingClientRect: () => rect, classList: { add: (...values: string[]) => values.forEach(value => classes.add(value)), remove: (...values: string[]) => values.forEach(value => classes.delete(value)) }, style: { setProperty: vi.fn(), removeProperty: vi.fn() } };
    const aboveFold = { ...node, getBoundingClientRect: () => ({ top: 100, bottom: 400 }) };
    const photoCaption = { ...node, matches: () => false };
    let onChange = () => {};
    const reduced = { matches: false, addEventListener: vi.fn((_event, callback) => { onChange = callback; }), removeEventListener: vi.fn() };
    const instances: { observed: unknown[]; callback: (entries: unknown[]) => void; disconnect: ReturnType<typeof vi.fn> }[] = [];
    class Observer {
        observed: unknown[] = [];
        disconnect = vi.fn();
        constructor(public callback: (entries: unknown[]) => void) { instances.push(this); }
        observe(target: unknown) { this.observed.push(target); }
    }
    vi.stubGlobal('IntersectionObserver', Observer);
    vi.stubGlobal('window', { innerHeight: 800, matchMedia: () => reduced });
    const query = vi.fn((_selector: string) => [node, aboveFold, photoCaption]);
    const root = { matches: () => false, querySelectorAll: query };
    const stop = watchScrollReveals(root as unknown as HTMLElement);
    expect(query.mock.calls[0][0]).toContain('.feature-visual');
    expect(query.mock.calls[0][0]).toContain('.home-security-visual');
    expect(instances[0].observed).toEqual([node]);
    expect(classes.size).toBe(0);
    const notify = (visible: boolean, ratio: number, bounds = rect) => instances[0].callback([{ target: node, isIntersecting: visible, intersectionRatio: ratio, boundingClientRect: bounds }]);
    notify(true, .08);
    expect(classes.size).toBe(0);
    notify(true, .2);
    expect(classes.has('public-scroll-arrived')).toBe(true);
    expect(classes.has('public-scroll-photo')).toBe(true);
    notify(false, 0, { top: -290, bottom: 10 });
    expect(classes.has('public-scroll-arrived')).toBe(true);
    notify(false, 0, { top: -300, bottom: 0 });
    expect(classes.has('public-scroll-arrived')).toBe(false);
    notify(true, .2);
    expect(classes.has('public-scroll-arrived')).toBe(true);
    reduced.matches = true;
    onChange();
    expect(classes.size).toBe(0);
    expect(instances[0].disconnect).toHaveBeenCalled();
    reduced.matches = false;
    onChange();
    expect(instances[1].observed).toEqual([node]);
    stop();
    expect(instances[1].disconnect).toHaveBeenCalled();
    expect(reduced.removeEventListener).toHaveBeenCalledWith('change', onChange);
});
