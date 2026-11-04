import crypto from 'node:crypto';
import type { JwtPayload } from 'jsonwebtoken';

export class InvalidSessionError extends Error {}
export function sessionErrorStatus(error: unknown): number {
    return error instanceof InvalidSessionError || (error instanceof Error && ['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(error.name)) ? 401 : 503;
}

type Database = { query: (sql: string, values: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export async function requireEnterpriseTerm(db: Database, userId: string): Promise<void> {
    if (process.env.QSVC_ENTERPRISE_TERMS_REQUIRED !== 'yes') return;
    const result = await db.query(
        'SELECT 1 FROM enterprise_access_terms WHERE user_id = $1 AND expires_at > now()',
        [userId],
    );
    if (!result.rows.length) throw new InvalidSessionError('Enterprise access term is missing or expired');
}

// shortcut: one active session per account for demos; add a session table for multi-device accounts.
export async function createSession(db: Database, userId: string): Promise<string> {
    const sessionId = crypto.randomUUID();
    const result = await db.query(
        `UPDATE users SET preferences = jsonb_set(COALESCE(preferences, '{}'::jsonb), '{_authSessionId}', to_jsonb($2::text)), last_login_at = NOW()
         WHERE id = $1 AND is_active = true RETURNING id`, [userId, sessionId]);
    if (result.rows.length !== 1) throw new Error('Inactive account');
    return sessionId;
}

export async function validateSession(db: Database, payload: JwtPayload): Promise<void> {
    if (typeof payload.sub !== 'string' || typeof payload.sessionId !== 'string' || typeof payload.tenantId !== 'string') {
        throw new InvalidSessionError('Invalid session');
    }
    const result = await db.query(
        `SELECT id FROM users WHERE id = $1 AND tenant_id = $2 AND is_active = true AND tenant_id IN (SELECT id FROM tenants WHERE is_active = true) AND preferences->>'_authSessionId' = $3`,
        [payload.sub, payload.tenantId, payload.sessionId]);
    if (result.rows.length !== 1) throw new InvalidSessionError('Session expired');
    await requireEnterpriseTerm(db, payload.sub);
}

export async function endSession(db: Database, payload: JwtPayload): Promise<void> {
    await db.query(`UPDATE users SET preferences = preferences - '_authSessionId'
        WHERE id = $1 AND tenant_id = $2 AND preferences->>'_authSessionId' = $3`,
        [payload.sub, payload.tenantId, payload.sessionId]);
}
