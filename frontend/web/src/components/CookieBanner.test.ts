import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import CookieBanner from './CookieBanner';
const render = () => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CookieBanner)));
afterEach(() => vi.unstubAllGlobals());
it('shows storage information on first visit and survives blocked storage', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); } });
    expect(render()).toContain('Read our cookie policy');
});
it('hides the acknowledged notice', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'deny' });
    expect(render()).toBe('');
});
