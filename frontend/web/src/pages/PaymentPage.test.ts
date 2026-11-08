import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import PaymentPage from './PaymentPage';

const render = (url: string) => renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [url] }, createElement(PaymentPage)));
describe('payment selection', () => {
    it('shows the selected plan while live pricing and provider availability load', () => {
        const html = render('/payment?plan=Pro');
        expect(html).toContain('QS-VC Pro');
        expect(html).toContain('Review the monthly price, GST and renewal terms before continuing.');
        expect(html).toContain('Loading current monthly price…');
        expect(html).toContain('Loading payment providers…');
        expect(html).toContain('role="status"');
    });
    it('explains that the seven-day trial is one-time and starts after provider confirmation', () => {
        const html = render('/payment?plan=Starter&trial=1');
        expect(html).toContain('Set up your Starter trial.');
        expect(html).toContain('One free 7-day trial per account.');
        expect(html).toContain('It begins after mandate authorization and lasts at least 7 days; the provider confirms the first-charge date.');
        expect(html).toContain('Choose a payment channel');
    });
    it('rejects unknown plans instead of inventing a price', () => {
        expect(render('/payment?plan=Other')).toContain('Choose a plan first.');
    });
});
