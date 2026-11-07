#!/usr/bin/env node

/**
 * QS-VC Database Migration Runner
 * Reads SQL files from db/migrations/ and executes them in order against PostgreSQL.
 * Usage: node db/migrate.js
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { databaseConfig } = require('../shared/database.cjs');
if (!process.env.MIGRATION_DATABASE_URL && !process.env.DATABASE_URL && !process.env.AUTH_DATABASE_URL) {
    console.error('No migration database URL: set MIGRATION_DATABASE_URL (or DATABASE_URL).');
    process.exit(1);
}
const pool = new Pool(databaseConfig({
    ...process.env,
    DATABASE_URL: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || process.env.AUTH_DATABASE_URL,
}));
pool.on('error', () => console.error('Database connection lost'));

async function migrate() {
    let client;
    try {
        client = await pool.connect();
        // Prevent two deployment processes from applying the same migration concurrently.
        await client.query('SELECT pg_advisory_lock(75291001)');
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

        // Never infer that an existing schema is fresh just because a legacy
        // deployment predates the migration ledger. Replaying 001 over live
        // tables can fail part-way through or leave mixed versions behind.
        if (appliedSet.size === 0) {
            const existingSchema = await client.query("SELECT to_regclass('public.users') IS NOT NULL AS present");
            if (existingSchema.rows[0]?.present) {
                throw new Error('Existing schema has no migration ledger. Verify its applied migration set and record a reviewed baseline before running migrations.');
            }
        }

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
                throw new Error('Database migration failed');
            }
        }

        console.log(`\n  Migration complete. ${count} new migration(s) applied.`);
    } finally {
        if (client) {
            client.release(true);
        }
        await pool.end();
    }
}

console.log('QS-VC Database Migration');
console.log('========================\n');
migrate().catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
});
