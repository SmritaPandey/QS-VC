import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { serviceSecret } from '../../../shared/service-secrets.cjs';
import { logger } from './logger.js';

const accountId = z.string().uuid();

export async function recordMeetingAttendance(
    code: string,
    user: { sub?: string; tenantId?: string },
    displayName: string,
): Promise<void> {
    if (!accountId.safeParse(user.sub).success || !accountId.safeParse(user.tenantId).success) return;
    try {
        const token = jwt.sign({}, serviceSecret('MEETING_POLICY_SECRET'), {
            audience: 'qsvc-meeting-policy', issuer: 'qsvc-internal', expiresIn: 30,
        });
        const response = await fetch(
            `${process.env.MEETING_INTERNAL_URL || 'http://localhost:4003'}/api/internal/meetings/${encodeURIComponent(code)}/attendance`,
            {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: user.sub, tenantId: user.tenantId, displayName }),
                signal: AbortSignal.timeout(5000),
            },
        );
        if (!response.ok) logger.warn({ status: response.status }, 'Meeting attendance was not saved');
    } catch (error) {
        logger.warn(error, 'Meeting attendance was not saved');
    }
}
