import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { calibrateCheckoutClock, checkoutTimeLeft, CheckoutProgressContent } from './CheckoutProgress';

describe('authoritative checkout deadline', () => {
    const created = { id: 'attempt', expiresAt: '2026-11-15T10:03:00Z', serverNow: '2026-11-15T10:00:00Z' };
    it('calibrates server remaining time to the local clock instead of trusting the client wall-clock zone', () => {
        expect(calibrateCheckoutClock(null, created, 1000)).toEqual({ id: 'attempt', deadline: 181000 });
    });
    it('preserves elapsed time on resume and does not extend an existing deadline', () => {
        const first = calibrateCheckoutClock(null, created, 1000)!;
        const resumed = calibrateCheckoutClock(first, { ...created, serverNow: '2026-11-15T10:02:00Z' }, 121000)!;
        expect(resumed.deadline).toBe(first.deadline);
        expect(checkoutTimeLeft(resumed.deadline, 151000)).toBe('0:30');
        expect(calibrateCheckoutClock(first, created, 121000)!.deadline).toBe(first.deadline);
    });
    it('reload uses the original server deadline and a new attempt alone starts a new clock', () => {
        expect(calibrateCheckoutClock(null, { ...created, serverNow: '2026-11-15T10:02:00Z' }, 5000)!.deadline).toBe(65000);
        expect(calibrateCheckoutClock({ id: 'old', deadline: 1 }, { ...created, id: 'new' }, 1000)!.deadline).toBe(181000);
    });
    it('does not invent timing for legacy or malformed responses and clamps elapsed time to zero', () => {
        expect(calibrateCheckoutClock(null, { ...created, expiresAt: null })).toBeNull();
        expect(calibrateCheckoutClock(null, { ...created, serverNow: 'invalid' })).toBeNull();
        expect(checkoutTimeLeft(1000, 2000)).toBe('0:00');
    });
});

describe('checkout status truth and accessibility', () => {
    const props = { phase: 'expired' as const, remaining: '0:00', hosted: true, canRetry: false, checking: false, onRefresh: () => {}, onRetry: () => {} };
    it('does not call an expired approval a failed payment or allow retry while cancellation is unresolved', () => {
        const html = renderToStaticMarkup(createElement(CheckoutProgressContent, props));
        expect(html).toContain('Approval window ended');
        expect(html).toContain('If you paid, do not pay again.');
        expect(html).not.toContain('Start a new checkout');
        expect(html).not.toContain('Payment failed');
        expect(html).toContain('redirects to the provider’s page in this tab');
    });
    it('offers a fresh attempt only when the server declares retry safe', () => {
        const html = renderToStaticMarkup(createElement(CheckoutProgressContent, { ...props, canRetry: true }));
        expect(html).toContain('Start a new checkout');
    });
    it('keeps second-by-second countdown outside the live status announcement', () => {
        const html = renderToStaticMarkup(createElement(CheckoutProgressContent, { ...props, phase: 'awaiting', remaining: '2:59' }));
        expect(html).toContain('aria-hidden="true" class="checkout-countdown">2:59');
        expect(html).not.toMatch(/role="status"[^>]*>2:59/);
    });
    it('does not show a countdown or retry during verified authorization reconciliation', () => {
        const html = renderToStaticMarkup(createElement(CheckoutProgressContent, { ...props, phase: 'verifying', canRetry: true }));
        expect(html).toContain('Verifying your payment setup');
        expect(html).not.toContain('Approval time remaining');
        expect(html).not.toContain('Start a new checkout');
    });
});
