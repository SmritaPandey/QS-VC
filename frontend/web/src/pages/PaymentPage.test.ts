import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import PaymentPage from './PaymentPage';

const render = (url: string) => renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [url] }, createElement(PaymentPage)));
describe('payment selection', () => {
    it('shows the selected plan and keeps unconnected payment disabled', () => {
        const html = render('/payment?plan=Pro');
        expect(html).toContain('QS-VC Pro');
        expect(html).toContain('₹999');
        expect(html).toContain('Razorpay');
        expect(html).toContain('PayPal');
        expect(html).toContain('disabled=""');
        expect(html).toContain('No payment will be taken.');
    });
    it('rejects unknown plans instead of inventing a price', () => {
        expect(render('/payment?plan=Other')).toContain('Choose a plan first.');
    });
});
