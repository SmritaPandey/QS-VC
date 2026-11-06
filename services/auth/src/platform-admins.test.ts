import { describe, expect, it } from 'vitest';
import { effectiveRole, isPlatformAdmin } from './platform-admins';

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
});
