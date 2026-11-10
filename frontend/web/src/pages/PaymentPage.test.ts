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
        expect(html).toContain('Loading current price…');
        expect(html).toContain('Loading payment providers…');
        expect(html).toContain('role="status"');
    });
    it('explains that the fourteen-day trial is one-time and starts after provider confirmation', () => {
        const html = render('/payment?plan=Starter&trial=1');
        expect(html).toContain('Set up your Starter trial.');
        expect(html).toContain('One free 14-day trial per account.');
        expect(html).toContain('Your trial starts when recurring payments are approved and lasts at least 14 days.');
        expect(html).toContain('Choose a payment channel');
    });
    it('rejects unknown plans instead of inventing a price', () => {
        expect(render('/payment?plan=Other')).toContain('Choose a plan first.');
    });
});
