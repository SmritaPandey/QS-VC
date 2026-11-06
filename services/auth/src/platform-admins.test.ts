import { describe, expect, it } from 'vitest';
import { effectiveRole, isPlatformAdmin, assertPlatformAdminConfig } from './platform-admins';

describe('platform admins', () => {
    it('grants admin to the default emails, case-insensitively', () => {
        expect(isPlatformAdmin('Services@MadyLabs.xyz', {})).toBe(true);
        expect(isPlatformAdmin('contact@neurqai.com', {})).toBe(true);
        expect(isPlatformAdmin(' smrita.official@gmail.com ', {})).toBe(true);
        expect(effectiveRole('someone@example.com', 'member', {})).toBe('member');
        expect(effectiveRole('contact@neurqai.com', 'member', {})).toBe('admin');
    });
    it('keeps the three built-in admins and adds QSVC_ADMIN_EMAILS entries', () => {
        const env = { QSVC_ADMIN_EMAILS: 'boss@example.com' };
        expect(isPlatformAdmin('boss@example.com', env)).toBe(true);
        expect(isPlatformAdmin('contact@neurqai.com', env)).toBe(true);
    });
    it('in onprem mode disables built-in emails and requires QSVC_ADMIN_EMAILS', () => {
        const onpremEmpty = { QSVC_DEPLOYMENT: 'onprem' };
        expect(isPlatformAdmin('contact@neurqai.com', onpremEmpty)).toBe(false);
        expect(() => assertPlatformAdminConfig(onpremEmpty)).toThrow('QSVC_DEPLOYMENT=onprem requires QSVC_ADMIN_EMAILS');

        const onpremConfigured = { QSVC_DEPLOYMENT: 'onprem', QSVC_ADMIN_EMAILS: 'onprem-admin@enterprise.internal' };
        expect(isPlatformAdmin('contact@neurqai.com', onpremConfigured)).toBe(false);
        expect(isPlatformAdmin('onprem-admin@enterprise.internal', onpremConfigured)).toBe(true);
        expect(() => assertPlatformAdminConfig(onpremConfigured)).not.toThrow();
    });
});
