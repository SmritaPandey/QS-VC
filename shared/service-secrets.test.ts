import { describe, expect, it } from 'vitest';
import { serviceSecret } from './service-secrets.cjs';
describe('purpose-specific service secrets', () => {
    it('fails closed for missing, default or reused secrets outside development', () => {
        for (const NODE_ENV of ['production', 'staging', undefined]) {
            expect(() => serviceSecret('TURN_ACCESS_SECRET', { NODE_ENV })).toThrow();
            expect(() => serviceSecret('TURN_ACCESS_SECRET', { NODE_ENV, TURN_ACCESS_SECRET: 'a'.repeat(32), JWT_SECRET: 'a'.repeat(32) })).toThrow();
        }
    });
    it('uses different local keys for different purposes', () => {
        expect(serviceSecret('TURN_ACCESS_SECRET', { NODE_ENV: 'test' })).not.toBe(serviceSecret('MEETING_POLICY_SECRET', { NODE_ENV: 'test' }));
    });
});
