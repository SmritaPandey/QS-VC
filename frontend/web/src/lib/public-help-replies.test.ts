import { describe, expect, it } from 'vitest';
import { productReply } from './public-help-replies';

describe('public product guide', () => {
    it('prioritises recording availability over generic meeting words', () => {
        const answer = productReply('Can I record a meeting?');
        expect(answer.text).toContain('where their workspace and meeting allow it');
        expect(answer.link?.to).toBe('/pricing');
    });
    it('states the encryption that meetings actually use and keeps deployment statements qualified', () => {
        expect(productReply('Is my meeting quantum safe?').text).toContain('end-to-end encryption with NIST-standardised post-quantum protection');
        expect(productReply('Is my meeting quantum safe?').text).toContain('security code');
        expect(productReply('Can my meeting work offline?').text).toContain('which features can work offline');
        expect(productReply('Which languages can I use?').text).toContain('depend on');
    });
    it('returns only authored guidance and internal links for unknown input', () => {
        const answer = productReply('<img src=x onerror=alert(1)> https://malicious.example');
        expect(answer.text).not.toContain('<img');
        expect(answer.link?.to).toBe('/contact');
        expect(productReply('PLANS AND PRICING').text).toContain('total and renewal terms before you approve payment');
        expect(productReply('How do I join?').link?.to).toBe('/app');
    });
});
