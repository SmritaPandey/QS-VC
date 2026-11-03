import crypto from 'node:crypto';
import type { JwtPayload } from 'jsonwebtoken';

type Database = { query: (sql: string, values: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

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
        throw new Error('Invalid session');
    }
    const result = await db.query(
        `SELECT id FROM users WHERE id = $1 AND tenant_id = $2 AND is_active = true AND tenant_id IN (SELECT id FROM tenants WHERE is_active = true) AND preferences->>'_authSessionId' = $3`,
        [payload.sub, payload.tenantId, payload.sessionId]);
    if (result.rows.length !== 1) throw new Error('Session expired');
}

export async function endSession(db: Database, payload: JwtPayload): Promise<void> {
    await db.query(`UPDATE users SET preferences = preferences - '_authSessionId'
        WHERE id = $1 AND tenant_id = $2 AND preferences->>'_authSessionId' = $3`,
        [payload.sub, payload.tenantId, payload.sessionId]);
}
