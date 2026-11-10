import type { Pool, PoolClient } from 'pg';
import { isPlatformAdmin } from './platform-admins.js';
import { inTenant, passwordBlocked, type Account } from './sso-store.js';
import type { PersonalProvider } from './personal-oidc.js';

type Identity = { provider: PersonalProvider; subject: string };
type Profile = { email: string; displayName: string; phoneNumber: string };
type Link = { user: string; tenant: string; session: string };

export class PersonalSignInError extends Error {}

export async function checkPersonalEmail(pool: Pool, email: string) {
    if (isPlatformAdmin(email)) throw new PersonalSignInError('Use the existing sign-in method for this account.');
    if (await passwordBlocked(pool, email)) throw new PersonalSignInError('Use your organisation sign-in for this email address.');
}

function lookup(db: PoolClient, tenant: string, { provider, subject }: Identity) {
    return db.query<Account>(
        `SELECT u.id, u.tenant_id, u.email, u.display_name, u.role, u.avatar_url
         FROM user_identities i JOIN users u ON u.id = i.user_id AND u.tenant_id = i.tenant_id
         WHERE i.tenant_id = $1 AND i.provider = $2 AND i.subject = $3 AND u.is_active AND u.role = 'member'`,
        [tenant, provider, subject],
    );
}

export async function findPersonalAccount(pool: Pool, tenant: string, identity: Identity) {
    const result = await inTenant(pool, tenant, db => lookup(db, tenant, identity));
    const account = result.rows[0];
    if (account) await checkPersonalEmail(pool, account.email);
    return account;
}

export async function assertAvailableEmail(pool: Pool, email: string) {
    await checkPersonalEmail(pool, email);
    const result = await pool.query('SELECT 1 FROM users WHERE lower(email) = $1 LIMIT 1', [email]);
    if (result.rows.length) throw new PersonalSignInError('This email already has an account. Sign in first, then link your provider in Sign-in settings.');
}

export async function attachIdentity(pool: Pool, tenant: string, identity: Identity, link?: Link, profile?: Profile) {
    if (link) {
        const { rows } = await pool.query<Account>("SELECT id, email FROM users WHERE id = $1 AND tenant_id = $2 AND role = 'member' AND is_active", [link.user, tenant]);
        if (!rows[0]) throw new PersonalSignInError('Provider linking is available for personal accounts.');
        await checkPersonalEmail(pool, rows[0].email);
    } else if (profile) await checkPersonalEmail(pool, profile.email);

    return inTenant(pool, tenant, async db => {
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${identity.provider}:${identity.subject}`]);
        const existing = (await lookup(db, tenant, identity)).rows[0];
        if (existing && link?.user === existing.id) return existing;
        if (existing) throw new PersonalSignInError('This provider is already connected. Start again from sign in.');
        if (link && link.tenant !== tenant) throw new PersonalSignInError('Provider linking is available for personal accounts.');
        const account = link ? await db.query<Account>(
            "SELECT id, tenant_id, email, display_name, role FROM users WHERE id = $1 AND tenant_id = $2 AND is_active AND role = 'member' FOR UPDATE",
            [link.user, tenant],
        ) : await db.query<Account>(
            `INSERT INTO users (tenant_id, email, display_name, phone_number, role, auth_provider,
                subscription_plan, trial_started_at, trial_ends_at)
             SELECT $1, $2, $3, $4, 'member', $5, NULL, NULL, NULL WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(email) = $2)
             ON CONFLICT (tenant_id, email) DO NOTHING RETURNING id, tenant_id, email, display_name, role`,
            [tenant, profile?.email, profile?.displayName, profile?.phoneNumber, identity.provider],
        );
        if (!account.rows[0]) throw new PersonalSignInError('This email already has an account. Sign in first, then link your provider in Sign-in settings.');
        const { rowCount } = await db.query(
            'INSERT INTO user_identities (tenant_id, user_id, provider, subject) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
            [tenant, account.rows[0].id, identity.provider, identity.subject],
        );
        if (rowCount !== 1) throw new PersonalSignInError('An account is already connected to this provider.');
        return account.rows[0];
    });
}
