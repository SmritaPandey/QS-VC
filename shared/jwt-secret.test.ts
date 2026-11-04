import { describe, expect, it } from 'vitest';
import { assertJwtSecret } from './jwt-secret.cjs';

describe('JWT production startup guard', () => {
    it.each([undefined, '', 'dev-jwt-secret-change-in-production', 'short'])('rejects unsafe production JWT settings', JWT_SECRET => {
        expect(() => assertJwtSecret({ NODE_ENV: 'production', JWT_SECRET })).toThrow('private JWT_SECRET');
    });

    it('allows local development and a configured production secret', () => {
        expect(() => assertJwtSecret({ NODE_ENV: 'development' })).not.toThrow();
        expect(() => assertJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'abcdefghijklmnopqrstuvwxyz012345' })).not.toThrow();
    });
});
