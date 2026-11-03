// Explicit operator-only setup. Run against a separate demo database, never a client database.
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { databaseConfig } = require('../../../shared/database.cjs');

async function main() {
    if (process.env.QSVC_DEMO_DATABASE !== 'yes' || !process.env.DATABASE_URL) {
        throw new Error('Set QSVC_DEMO_DATABASE=yes and DATABASE_URL for an isolated demo database.');
    }
    const output = process.env.DEMO_CREDENTIALS_FILE;
    if (!output || !path.isAbsolute(output)) throw new Error('Set DEMO_CREDENTIALS_FILE to an absolute private output path.');
    const fd = fs.openSync(output, 'wx', 0o600);
    const pool = new Pool(databaseConfig());
    pool.on('error', () => console.error('Database connection lost'));
    let client;
    let committed = false;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const tenantId = crypto.randomUUID();
        const slug = `demo-${crypto.randomBytes(6).toString('hex')}`;
        await client.query('INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)', [tenantId, 'QS-VC Synthetic Demo', slug]);
        const accounts = [];
        for (const [name, email] of [['Demo Host', 'host@example.test'], ['Demo Participant', 'participant@example.test']]) {
            const password = crypto.randomBytes(24).toString('base64url');
            await client.query(`INSERT INTO users (id, tenant_id, email, display_name, password_hash, role)
                VALUES ($1,$2,$3,$4,$5,'member')`, [crypto.randomUUID(), tenantId, email, name, await bcrypt.hash(password, 12)]);
            accounts.push({ email, password, tenantSlug: slug });
        }
        fs.writeFileSync(fd, JSON.stringify({ accounts }, null, 2));
        await client.query('COMMIT');
        committed = true;
        console.log('Synthetic demo accounts created. Credentials saved privately to the chosen file.');
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        throw error;
    } finally {
        fs.closeSync(fd);
        if (!committed) fs.unlinkSync(output);
        client?.release();
        await pool.end();
    }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
