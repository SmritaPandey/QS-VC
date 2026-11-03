// Operator-only: create or update the platform-admin accounts (QSVC_ADMIN_EMAILS) with one password.
// The password is read from QSVC_ADMIN_PASSWORD and is never printed, logged or stored in plain text.
//   DATABASE_URL=postgres://... QSVC_ADMIN_PASSWORD='...' node services/auth/scripts/create-platform-admins.cjs
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const { databaseConfig } = require('../../../shared/database.cjs');

const DEFAULT_ADMINS = ['services@madylabs.xyz', 'contact@neurqai.com', 'smrita.official@gmail.com'];

async function main() {
    const password = process.env.QSVC_ADMIN_PASSWORD || '';
    if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to the QS-VC database.');
    if (password.length < 8 || password.length > 128) throw new Error('Set QSVC_ADMIN_PASSWORD (8-128 characters).');
    const emails = (process.env.QSVC_ADMIN_EMAILS || DEFAULT_ADMINS.join(','))
        .split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
    const pool = new Pool(databaseConfig());
    pool.on('error', () => console.error('Database connection lost'));
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const tenant = await client.query("SELECT id FROM tenants WHERE slug = 'personal-free' AND is_active = true");
        if (tenant.rows.length !== 1) throw new Error("Tenant 'personal-free' is missing. Run node db/migrate.js first.");
        const hash = await bcrypt.hash(password, 12);
        for (const email of emails) {
            const existing = await client.query('SELECT id FROM users WHERE lower(email) = $1', [email]);
            if (existing.rows.length > 1) throw new Error(`${email} has ${existing.rows.length} accounts; remove the duplicates first.`);
            if (existing.rows.length === 1) {
                // A new password also ends any session that used the old one.
                await client.query(`UPDATE users SET password_hash = $1, role = 'admin', is_active = true,
                    preferences = preferences - '_authSessionId', updated_at = NOW() WHERE id = $2`, [hash, existing.rows[0].id]);
                console.log(`Updated: ${email} (admin)`);
            } else {
                const name = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).slice(0, 100);
                await client.query(`INSERT INTO users (id, tenant_id, email, display_name, password_hash, role)
                    VALUES ($1, $2, $3, $4, $5, 'admin')`, [crypto.randomUUID(), tenant.rows[0].id, email, name, hash]);
                console.log(`Created: ${email} (admin)`);
            }
        }
        await client.query('COMMIT');
        console.log('Done. Ask each admin to change this shared password after first sign-in.');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
