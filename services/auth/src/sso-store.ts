import { createHash, randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { isPlatformAdmin } from './platform-admins.js';

export const randomProof = () => randomBytes(32).toString('base64url');
export const proofHash = (value: string) => createHash('sha256').update(value).digest('base64url');
export const isProof = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{43}$/.test(value);
export const emailDomain = (email: string) => email.slice(email.lastIndexOf('@') + 1).toLowerCase();
export const brokerAlias = (id: string) => `qsvc-${id}`;

export type Connection = {
    id: string; tenant_id: string; domain: string; dns_token: string;
    provider: 'oidc' | 'saml' | null; verified_at: Date | null; tested_at: Date | null; enforce_sso: boolean;
};
export type Account = { id: string; tenant_id: string; email: string; display_name: string; role: string; avatar_url?: string };

export async function transaction<T>(pool: Pool, run: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await pool.connect();
    try {
        await db.query('BEGIN');
        const result = await run(db);
        await db.query('COMMIT');
        return result;
    } catch (error) {
        await db.query('ROLLBACK');
        throw error;
    } finally { db.release(); }
}
export async function inTenant<T>(pool: Pool, tenant: string, run: (db: PoolClient) => Promise<T>) {
    return transaction(pool, async db => {
        await db.query("SELECT set_config('app.current_tenant', $1, true)", [tenant]);
        return run(db);
    });
}

export async function discover(pool: Pool, domain: string): Promise<Connection | undefined> {
    return transaction(pool, async db => {
        await db.query("SELECT set_config('app.sso_domain', $1, true)", [domain]);
        const { rows } = await db.query<Connection>(
            `SELECT c.* FROM sso_connections c JOIN tenants t ON t.id = c.tenant_id
             WHERE c.domain = $1 AND c.verified_at IS NOT NULL AND t.is_active AND t.plan = 'enterprise'`, [domain],
        );
        return rows[0];
    });
}

export async function passwordBlocked(db: Pool, email: string) {
    return !isPlatformAdmin(email) && !!(await discover(db, emailDomain(email)))?.enforce_sso;
}

type Kind = 'launch' | 'oidc' | 'exchange' | 'digilocker' | 'digilocker_launch' | 'digilocker_consent'
    | 'personal_launch' | 'personal_oidc' | 'personal_exchange' | 'personal_enrol' | 'personal_email';
export async function remember(pool: Pool, kind: Kind, payload: object, key = randomProof()) {
    await transaction(pool, async db => {
        const hash = proofHash(key);
        await db.query("SELECT set_config('app.sso_challenge', $1, true)", [hash]);
        await db.query('DELETE FROM sso_challenges WHERE expires_at <= now()');
        await db.query('INSERT INTO sso_challenges (key_hash, kind, payload) VALUES ($1, $2, $3)', [hash, kind, payload]);
    });
    return key;
}

export async function consume<T>(pool: Pool, kind: Kind, key: string, binding?: string): Promise<T | undefined> {
    return transaction(pool, async db => {
        const hash = proofHash(key);
        await db.query("SELECT set_config('app.sso_challenge', $1, true)", [hash]);
        const { rows } = await db.query<{payload: T}>(
            `DELETE FROM sso_challenges WHERE key_hash = $1 AND kind = $2 AND expires_at > now()
             AND ($3::text IS NULL OR payload->>'binding' = $3) RETURNING payload`, [hash, kind, binding ?? null],
        );
        return rows[0]?.payload;
    });
}

export function trustedClaims(connection: Connection, claims: Record<string, unknown>, expectedEmail?: string) {
    const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
    if (!connection.verified_at || !connection.provider || claims.qsvc_idp !== brokerAlias(connection.id)
        || claims.email_verified !== true || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255
        || !email.includes('@') || email.length > 255 || emailDomain(email) !== connection.domain
        || (expectedEmail && expectedEmail !== email) || isPlatformAdmin(email)) {
        throw new Error('The identity provider did not verify this account for the organisation.');
    }
    return { subject: claims.sub, email, name: typeof claims.name === 'string' ? claims.name.trim().slice(0, 255) || email : email };
}

export async function provision(pool: Pool, connection: Connection, identity: ReturnType<typeof trustedClaims>, linkUser?: string) {
    return inTenant(pool, connection.tenant_id, async db => {
        // Serialize callbacks and configuration changes for this connection.
        const locked = await db.query(
            `SELECT c.id FROM sso_connections c JOIN tenants t ON c.tenant_id = t.id
             WHERE c.id = $1 AND c.verified_at IS NOT NULL AND c.provider = $2 AND t.is_active AND t.plan = 'enterprise' FOR UPDATE OF c`,
            [connection.id, connection.provider],
        );
        if (!locked.rows.length) throw new Error('SSO connection is unavailable.');
        const linked = await db.query<Account>(
            `SELECT u.* FROM user_identities i JOIN users u ON u.id = i.user_id AND u.tenant_id = i.tenant_id
             WHERE i.connection_id = $1 AND i.subject = $2`, [connection.id, identity.subject],
        );
        const existing = linked.rows[0];
        if (existing && (existing.email.toLowerCase() !== identity.email || (linkUser && existing.id !== linkUser))) {
            throw new Error('This identity belongs to another account.');
        }
        if (!existing) {
            const account = linkUser
                ? await db.query<Account>('SELECT * FROM users WHERE tenant_id = $1 AND id = $2 AND lower(email) = $3 AND is_active',
                    [connection.tenant_id, linkUser, identity.email])
                : await db.query<Account>(
                    `INSERT INTO users (tenant_id, email, display_name, role, auth_provider, enterprise_status)
                     SELECT $1, $2, $3, 'member', 'sso', 'enterprise_approved'
                     WHERE NOT EXISTS (SELECT 1 FROM users WHERE tenant_id = $1 AND lower(email) = $2)
                     ON CONFLICT (tenant_id, email) DO NOTHING RETURNING *`,
                    [connection.tenant_id, identity.email, identity.name],
                );
            if (!account.rows[0]) throw new Error('The existing account must be linked while signed in.');
            await db.query(
                "INSERT INTO user_identities (tenant_id, user_id, connection_id, provider, subject) VALUES ($1,$2,$3,'keycloak',$4)",
                [connection.tenant_id, account.rows[0].id, connection.id, identity.subject],
            );
            return account.rows[0];
        }
        return existing;
    });
}
