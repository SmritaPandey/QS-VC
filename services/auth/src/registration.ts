import { z } from 'zod';

export const registerBody = z.object({
    email: z.string().email('Invalid email').max(255),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
    displayName: z.string().min(1, 'Display name is required').max(100)
        .transform((s) => s.trim().replace(/<[^>]*>/g, '')),
    tenantSlug: z.never().optional(),
});
