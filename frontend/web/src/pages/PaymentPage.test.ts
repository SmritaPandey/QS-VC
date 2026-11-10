import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import PaymentPage, { PaymentProviderChoices } from './PaymentPage';

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

describe('payment gateway choices', () => {
    const quote = { enabled: true, trialEnabled: true, currency: 'INR', baseAmount: '57.00', taxAmount: '10.26', totalAmount: '67.26' };
    const providers = {
        cashfree: { ...quote, mode: 'live' as const },
        razorpay: { ...quote, mode: 'test' as const },
        paypal: { ...quote, enabled: false, trialEnabled: false, mode: 'test' as const },
    };
    const choices = (available: ('cashfree' | 'razorpay' | 'paypal')[], loading = false) => renderToStaticMarkup(createElement(PaymentProviderChoices, {
        selected: 'cashfree', available, providers, loading, disabled: false, onSelect: () => {},
    }));
    const radio = (html: string, value: string) => html.match(/<input\b[^>]*>/g)!.find(tag => tag.includes(`value="${value}"`))!;

    it('keeps live Cashfree and test Razorpay selectable while showing PayPal as blocked', () => {
        const html = choices(['cashfree', 'razorpay']);
        expect(html).toContain('Cashfree UPI AutoPay');
        expect(html).toContain('BHIM');
        expect(html).toContain('>Live</span>');
        expect(html).toContain('>Test mode</span>');
        expect(html).toContain('PayPal');
        expect(html).toContain('>Unavailable</span>');
        expect(radio(html, 'cashfree')).toContain('checked');
        expect(radio(html, 'cashfree')).not.toContain('disabled');
        expect(radio(html, 'razorpay')).not.toContain('disabled');
        expect(radio(html, 'paypal')).toContain('disabled');
        expect(radio(html, 'paypal')).not.toContain('checked');
    });

    it('keeps all choices visible and disabled when no gateway is available', () => {
        const html = choices([]);
        for (const provider of ['cashfree', 'razorpay', 'paypal']) {
            expect(radio(html, provider)).toContain('disabled');
            expect(radio(html, provider)).not.toContain('checked');
        }
        expect(html.match(/Unavailable/g)).toHaveLength(3);
    });

    it('shows pending choices without claiming that checkout is ready', () => {
        const html = choices([], true);
        expect(html.match(/>Checking…<\/span>/g)).toHaveLength(3);
        expect(html).not.toContain('>Live</span>');
        expect(html).not.toContain('>Unavailable</span>');
    });

    it('keeps a configured test gateway blocked when its recurring checkout is not ready', () => {
        const html = choices(['cashfree']);
        expect(html).toContain('Test mode · Unavailable');
        expect(radio(html, 'razorpay')).toContain('disabled');
        expect(radio(html, 'cashfree')).not.toContain('disabled');
    });
});
