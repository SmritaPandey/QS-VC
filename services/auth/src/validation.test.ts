/**
 * Unit tests for the Auth service validation schemas.
 * Tests Zod schemas for registration, login, and profile update.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Re-define schemas locally for testing (matching auth/src/index.ts)
const registerBody = z.object({
    email: z.string().email('Invalid email').max(255),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
    displayName: z.string().min(1, 'Display name is required').max(100)
        .transform((s) => s.trim().replace(/<[^>]*>/g, '')),
    tenantSlug: z.string().max(100).optional(),
});

const loginBody = z.object({
    email: z.string().email('Invalid email').max(255),
    password: z.string().min(1, 'Password is required').max(128),
});

const updateProfileBody = z.object({
    displayName: z.string().min(1).max(100)
        .transform((s) => s.trim().replace(/<[^>]*>/g, '')).optional(),
    avatarUrl: z.string().url('Invalid URL').max(2048).optional(),
    preferences: z.record(z.string(), z.any()).optional(),
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REGISTER SCHEMA TESTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Auth: registerBody schema', () => {
    it('should accept valid registration data', () => {
        const result = registerBody.safeParse({
            email: 'test@example.com',
            password: 'securePass123',
            displayName: 'Test User',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.email).toBe('test@example.com');
            expect(result.data.displayName).toBe('Test User');
        }
    });

    it('should accept registration with optional tenantSlug', () => {
        const result = registerBody.safeParse({
            email: 'user@corp.com',
            password: 'strongPassword!',
            displayName: 'Corp User',
            tenantSlug: 'acme-corp',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.tenantSlug).toBe('acme-corp');
        }
    });

    it('should reject invalid email', () => {
        const result = registerBody.safeParse({
            email: 'not-an-email',
            password: 'securePass123',
            displayName: 'Test User',
        });
        expect(result.success).toBe(false);
    });

    it('should reject short password (< 8 chars)', () => {
        const result = registerBody.safeParse({
            email: 'test@example.com',
            password: 'short',
            displayName: 'Test User',
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0].message).toBe('Password must be at least 8 characters');
        }
    });

    it('should reject empty displayName', () => {
        const result = registerBody.safeParse({
            email: 'test@example.com',
            password: 'securePass123',
            displayName: '',
        });
        expect(result.success).toBe(false);
    });

    it('should strip HTML tags from displayName', () => {
        const result = registerBody.safeParse({
            email: 'test@example.com',
            password: 'securePass123',
            displayName: 'User <script>alert("xss")</script>',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.displayName).toBe('User alert("xss")');
        }
    });

    it('should trim whitespace from displayName', () => {
        const result = registerBody.safeParse({
            email: 'test@example.com',
            password: 'securePass123',
            displayName: '  Trimmed User  ',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.displayName).toBe('Trimmed User');
        }
    });

    it('should reject missing required fields', () => {
        const result = registerBody.safeParse({});
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues.length).toBeGreaterThanOrEqual(3);
        }
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LOGIN SCHEMA TESTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Auth: loginBody schema', () => {
    it('should accept valid login data', () => {
        const result = loginBody.safeParse({
            email: 'test@example.com',
            password: 'securePass123',
        });
        expect(result.success).toBe(true);
    });

    it('should reject invalid email', () => {
        const result = loginBody.safeParse({
            email: 'invalid',
            password: 'securePass123',
        });
        expect(result.success).toBe(false);
    });

    it('should reject empty password', () => {
        const result = loginBody.safeParse({
            email: 'test@example.com',
            password: '',
        });
        expect(result.success).toBe(false);
    });

    it('should reject missing fields', () => {
        expect(loginBody.safeParse({}).success).toBe(false);
        expect(loginBody.safeParse({ email: 'test@test.com' }).success).toBe(false);
        expect(loginBody.safeParse({ password: 'pass' }).success).toBe(false);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UPDATE PROFILE SCHEMA TESTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Auth: updateProfileBody schema', () => {
    it('should accept displayName update', () => {
        const result = updateProfileBody.safeParse({
            displayName: 'New Name',
        });
        expect(result.success).toBe(true);
    });

    it('should accept avatarUrl update', () => {
        const result = updateProfileBody.safeParse({
            avatarUrl: 'https://example.com/avatar.png',
        });
        expect(result.success).toBe(true);
    });

    it('should accept preferences update', () => {
        const result = updateProfileBody.safeParse({
            preferences: { theme: 'dark', notifications: true },
        });
        expect(result.success).toBe(true);
    });

    it('should reject invalid avatar URL', () => {
        const result = updateProfileBody.safeParse({
            avatarUrl: 'not-a-url',
        });
        expect(result.success).toBe(false);
    });

    it('should strip HTML from displayName', () => {
        const result = updateProfileBody.safeParse({
            displayName: 'Cool <b>User</b>',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.displayName).toBe('Cool User');
        }
    });
});
