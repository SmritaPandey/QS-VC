import { z } from 'zod';

export const phoneNumberSchema = z.string().trim()
    .transform((value) => value.replace(/[\s()-]/g, ''))
    .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Enter a valid mobile number with country code, such as +919876543210'));

export const registerBody = z.object({
    email: z.string().email('Invalid email').max(255),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
    displayName: z.string().min(1, 'Display name is required').max(100)
        .transform((s) => s.trim().replace(/<[^>]*>/g, '')),
    phoneNumber: phoneNumberSchema,
    tenantSlug: z.never().optional(),
});
