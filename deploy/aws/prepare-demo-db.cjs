// Run after migrations, before public traffic, against the isolated AWS demo only.
const { Pool } = require('pg');
const { databaseConfig } = require('../../shared/database.cjs');
async function main() {
    if (process.env.QSVC_DEMO_DATABASE !== 'yes') throw new Error('Explicit demo database confirmation is required');
    const pool = new Pool(databaseConfig());
    pool.on('error', () => console.error('Database connection lost'));
    try {
        await pool.query(`UPDATE users SET is_active = false, preferences = preferences - '_authSessionId'
            WHERE id = '00000000-0000-0000-0000-000000000010' AND email = 'admin@qsvc.dev'`);
        const check = await pool.query(`SELECT id FROM users WHERE email = 'admin@qsvc.dev' AND is_active = true`);
        if (check.rows.length) throw new Error('Development administrator is still enabled');
        console.log('Development administrator disabled; create private synthetic demo accounts next');
    } finally { await pool.end(); }
}
main().catch(() => { console.error('Demo database preparation failed'); process.exitCode = 1; });
