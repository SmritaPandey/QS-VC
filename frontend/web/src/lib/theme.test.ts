import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const script = readFileSync(new URL('../../public/theme.js', import.meta.url), 'utf8');
function boot({ dark = false, consent, preference, blocked = false, noMedia = false }: { dark?: boolean; consent?: string; preference?: string; blocked?: boolean; noMedia?: boolean } = {}) {
    const data = new Map<string,string>();
    if (consent) data.set('qsvc:storage-consent:v2', consent);
    if (preference) data.set('qsvc:theme', preference);
    const events = new Map<string, (event?: any) => void>();
    const media = { matches: dark, addEventListener: (_: string, fn: () => void) => events.set('media', fn) };
    const root = { dataset: {} as { theme?: string }, style: {} as { colorScheme?: string } };
    const meta = { content: '' };
    const window = { matchMedia: () => { if (noMedia) throw Error('unavailable'); return media; }, addEventListener: (name: string, fn: () => void) => events.set(name, fn), qsvcTheme: null as any };
    const storage = { getItem: (key: string) => { if (blocked) throw Error('blocked'); return data.get(key) ?? null; }, setItem: (key: string, value: string) => { if (blocked) throw Error('blocked'); data.set(key,value); }, removeItem: (key: string) => { if (blocked) throw Error('blocked'); data.delete(key); } };
    runInNewContext(script, { window, document: { documentElement: root, querySelector: () => meta }, localStorage: storage });
    return { data, events, media, root, meta, theme: window.qsvcTheme };
}

describe('the exact shared first-paint/runtime theme owner', () => {
    it('defaults to system, resolves dark live, and falls back to light without media support', () => {
        const app = boot();
        expect(app.root.dataset.theme).toBe('light');
        expect(app.theme.getPreference()).toBe('system');
        app.media.matches = true; app.events.get('media')!();
        expect(app.root.dataset.theme).toBe('dark');
        expect(app.root.style.colorScheme).toBe('dark');
        expect(app.meta.content).toBe('#0b1420');
        expect(boot({ noMedia: true }).root.dataset.theme).toBe('light');
    });
    it('uses an allowed explicit choice before paint and ignores later system changes', () => {
        const app = boot({ dark: true, consent: 'allow', preference: 'light' });
        expect(app.root.dataset.theme).toBe('light');
        app.events.get('media')!(); expect(app.root.dataset.theme).toBe('light');
        app.theme.setPreference('system');
        expect(app.root.dataset.theme).toBe('dark');
        expect(app.data.has('qsvc:theme')).toBe(false);
    });
    it('does not read stale preferences without consent, and does not write manual memory choices', () => {
        const app = boot({ preference: 'dark' });
        expect(app.root.dataset.theme).toBe('light');
        app.theme.setPreference('dark');
        expect(app.root.dataset.theme).toBe('dark');
        expect(app.data.has('qsvc:theme')).toBe(false);
    });
    it('persists only after allow, and denial removes storage while retaining this tab’s choice', () => {
        const app = boot(); app.theme.setPreference('dark');
        app.events.get('qsvc:storage-consent')!({ detail: true });
        expect(app.data.get('qsvc:theme')).toBe('dark');
        app.events.get('qsvc:storage-consent')!({ detail: false });
        expect(app.data.has('qsvc:theme')).toBe(false);
        expect(app.root.dataset.theme).toBe('dark');
    });
    it('remains usable with blocked storage and rejects corrupt stored values', () => {
        const app = boot({ blocked: true }); app.theme.setPreference('dark');
        expect(app.root.dataset.theme).toBe('dark');
        expect(boot({ consent: 'allow', preference: 'broken', dark: true }).theme.getPreference()).toBe('system');
    });
    it('syncs preferences and consent across tabs, including cleared storage', () => {
        const app = boot({ consent: 'allow' });
        app.data.set('qsvc:theme', 'dark'); app.events.get('storage')!({ key: 'qsvc:theme' });
        expect(app.root.dataset.theme).toBe('dark');
        app.data.set('qsvc:storage-consent:v2','deny'); app.events.get('storage')!({ key: 'qsvc:storage-consent:v2' });
        expect(app.theme.getPreference()).toBe('system');
        app.data.clear(); app.events.get('storage')!({ key: null });
        expect(app.root.dataset.theme).toBe('light');
    });
    it('unsubscribes component listeners without removing the page-lifetime system observer', () => {
        const app = boot(); let count = 0;
        const unsubscribe = app.theme.subscribe(() => count++);
        app.theme.setPreference('dark'); expect(count).toBe(1);
        unsubscribe(); app.theme.setPreference('light'); expect(count).toBe(1);
        expect(app.events.has('media')).toBe(true);
    });
});
