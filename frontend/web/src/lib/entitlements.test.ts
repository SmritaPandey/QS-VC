import { describe, expect, it } from 'vitest';
import { hasFeature } from './entitlements';

describe('client feature access', () => {
    it('keeps verified admins unlocked when the plan lookup has no feature list', () => {
        expect(hasFeature({ isPlatformAdmin: true, features: [] }, 'cloud_recording')).toBe(true);
    });

    it('uses server features for non-admins', () => {
        expect(hasFeature({ isPlatformAdmin: false, features: ['ai_captions'] }, 'ai_captions')).toBe(true);
        expect(hasFeature({ isPlatformAdmin: false, features: ['ai_captions'] }, 'cloud_recording')).toBe(false);
    });
});
