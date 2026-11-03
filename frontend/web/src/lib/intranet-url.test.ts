import { describe, expect, it } from 'vitest';
import { intranetUrl } from './intranet-url';
describe('organisation workspace address', () => {
    it('accepts HTTPS private workspace addresses', () => {
        expect(intranetUrl(' https://meet.office.internal/app ')).toBe('https://meet.office.internal/app');
        expect(intranetUrl('https://192.168.1.10:8443')).toBe('https://192.168.1.10:8443/');
    });
    it('rejects scripts, insecure URLs and credential-bearing links', () => {
        for (const value of ['javascript:alert(1)', 'http://office.local', '//office.local', 'https://user:pass@office.local', 'https://office.local?token=secret', 'https://office.local/#secret', 'invalid']) expect(intranetUrl(value)).toBeNull();
    });
});
