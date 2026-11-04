import { describe, expect, it } from 'vitest';
import { intranetUrl, isOnlineTestWorkspace } from './intranet-url';
describe('organisation workspace address', () => {
    it('accepts HTTPS private workspace addresses', () => {
        expect(intranetUrl(' https://meet.office.internal/app ')).toBe('https://meet.office.internal/app');
        expect(intranetUrl('https://192.168.1.10:8443')).toBe('https://192.168.1.10:8443/app');
    });
    it('rejects links back to the public portal', () => {
        expect(intranetUrl('https://qsvcmeet.com/')).toBeNull();
        expect(intranetUrl('https://www.qsvcmeet.com/')).toBeNull();
        expect(intranetUrl('https://portal.example.test/', 'https://portal.example.test')).toBeNull();
    });
    it('allows qsvcmeet.com only for the explicit admin online-demo mode', () => {
        expect(intranetUrl('https://qsvcmeet.com/', 'https://qsvcmeet.com', true)).toBe('https://qsvcmeet.com/app');
        expect(intranetUrl('https://qsvcmeet.com/app', 'https://qsvcmeet.com')).toBeNull();
        expect(isOnlineTestWorkspace('https://qsvcmeet.com/app')).toBe(true);
        expect(isOnlineTestWorkspace('http://qsvcmeet.com/app')).toBe(false);
    });
    it('rejects scripts, insecure URLs and credential-bearing links', () => {
        for (const value of ['javascript:alert(1)', 'http://office.local', '//office.local', 'https://user:pass@office.local', 'https://office.local?token=secret', 'https://office.local/#secret', 'invalid']) expect(intranetUrl(value)).toBeNull();
    });
});
