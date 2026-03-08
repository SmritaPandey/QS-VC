#!/usr/bin/env node

/**
 * QS-VC Database Migration Runner
 * Reads SQL files from db/migrations/ and executes them in order against PostgreSQL.
 * Usage: node db/migrate.js
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'qsvc',
    user: process.env.POSTGRES_USER || 'qsvc',
    password: process.env.POSTGRES_PASSWORD || 'qsvc_dev_2025',
});

async function migrate() {
    const client = await pool.connect();
    try {
        // Create migrations tracking table
        await client.query(`
            CREATE TABLE IF NOT EXISTS _migrations (
                id SERIAL PRIMARY KEY,
                filename VARCHAR(255) UNIQUE NOT NULL,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);

        // Get already-applied migrations
        const applied = await client.query('SELECT filename FROM _migrations ORDER BY id');
        const appliedSet = new Set(applied.rows.map((r) => r.filename));

        // Read migration files
        const migrationsDir = path.join(__dirname, 'migrations');
        const files = fs.readdirSync(migrationsDir)
            .filter((f) => f.endsWith('.sql'))
            .sort();

        let count = 0;
        for (const file of files) {
            if (appliedSet.has(file)) {
                console.log(`  ✓ ${file} (already applied)`);
                continue;
            }

            const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
            console.log(`  → Applying ${file}...`);

            await client.query('BEGIN');
            try {
                await client.query(sql);
                await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
                await client.query('COMMIT');
                console.log(`  ✓ ${file} applied`);
                count++;
            } catch (err) {
                await client.query('ROLLBACK');
                console.error(`  ✗ ${file} FAILED:`, err.message);
                process.exit(1);
            }
        }

        console.log(`\n  Migration complete. ${count} new migration(s) applied.`);
    } finally {
        client.release();
        await pool.end();
    }
}

console.log('QS-VC Database Migration');
console.log('========================\n');
migrate().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
});
