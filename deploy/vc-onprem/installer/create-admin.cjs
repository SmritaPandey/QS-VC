// Run inside the auth container by QS-VC Server Setup: creates or updates the first administrator.
// Inputs come only from the environment (QSVC_DB_URL, QSVC_ADMIN_EMAIL, QSVC_ADMIN_PASSWORD); nothing is printed except the outcome.
const { Pool } = require('/app/node_modules/pg');
const bcrypt = require('/app/node_modules/bcryptjs');
const crypto = require('node:crypto');

(async () => {
    const email = (process.env.QSVC_ADMIN_EMAIL || '').trim().toLowerCase();
    const password = process.env.QSVC_ADMIN_PASSWORD || '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Invalid administrator email.');
    if (password.length < 12 || password.length > 128) throw new Error('Administrator password must be 12-128 characters.');
    const pool = new Pool({ connectionString: process.env.QSVC_DB_URL, max: 1 });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const tenant = await client.query("SELECT id FROM tenants WHERE slug = 'personal-free' AND is_active = true");
        if (tenant.rows.length !== 1) throw new Error("Default tenant 'personal-free' is missing.");
        const hash = await bcrypt.hash(password, 12);
        const existing = await client.query('SELECT id FROM users WHERE lower(email) = $1', [email]);
        if (existing.rows.length > 1) throw new Error('More than one account uses this email.');
        if (existing.rows.length === 1) {
            await client.query(`UPDATE users SET password_hash = $1, role = 'admin', is_active = true,
                preferences = preferences - '_authSessionId', updated_at = NOW() WHERE id = $2`, [hash, existing.rows[0].id]);
            console.log('Administrator updated');
        } else {
            const name = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).slice(0, 100);
            await client.query(`INSERT INTO users (id, tenant_id, email, display_name, password_hash, role)
                VALUES ($1, $2, $3, $4, $5, 'admin')`, [crypto.randomUUID(), tenant.rows[0].id, email, name, hash]);
            console.log('Administrator created');
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
})().catch(error => { console.error(error.message); process.exit(1); });
