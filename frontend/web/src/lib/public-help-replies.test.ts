import { describe, expect, it } from 'vitest';
import { productReply } from './public-help-replies';

describe('public product guide', () => {
    it('prioritises recording availability over generic meeting words', () => {
        const answer = productReply('Can I record a meeting?');
        expect(answer.text).toContain('not currently available');
        expect(answer.text).toContain('planned');
        expect(answer.link?.to).toBe('/pricing');
    });
    it('keeps security and deployment statements qualified', () => {
        expect(productReply('Is my meeting quantum safe?').text).toContain('part of QS-VC’s design');
        expect(productReply('Can my meeting work offline?').text).toContain('separate validation');
        expect(productReply('Which languages can I use?').text).toContain('depend on');
    });
    it('returns only authored guidance and internal links for unknown input', () => {
        const answer = productReply('<img src=x onerror=alert(1)> https://malicious.example');
        expect(answer.text).not.toContain('<img');
        expect(answer.link?.to).toBe('/contact');
        expect(productReply('PLANS AND PRICING').text).toContain('proposed');
        expect(productReply('How do I join?').link?.to).toBe('/app');
    });
});
