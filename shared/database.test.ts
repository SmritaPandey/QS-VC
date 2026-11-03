import { describe, it, expect } from 'vitest';
import { databaseConfig } from './database.cjs';

describe('deployment database configuration', () => {
    it('keeps offline local PostgreSQL independent of AWS', () => {
        const config = databaseConfig({ POSTGRES_HOST: 'postgres', POSTGRES_DB: 'office' });
        expect(config.host).toBe('postgres');
        expect(config.database).toBe('office');
        expect(config.ssl).toBe(false);
        expect(config.connectionString).toBeUndefined();
    });
    it('verifies remote certificates even when the URL requests weaker SSL', () => {
        const config = databaseConfig({ DATABASE_URL: 'postgres://user:secret@demo.rds.amazonaws.com/qsvc?sslmode=no-verify' });
        expect(config.ssl).toEqual({ rejectUnauthorized: true });
        expect(config.connectionString).not.toContain('sslmode');
    });
    it('bounds connections, queries, lock waits and abandoned transactions', () => {
        const config = databaseConfig({});
        expect(config.max).toBe(10);
        expect(config.connectionTimeoutMillis).toBe(3000);
        expect(config.statement_timeout).toBe(5000);
        expect(config.lock_timeout).toBe(2000);
        expect(config.idle_in_transaction_session_timeout).toBe(10000);
        expect(config.query_timeout).toBeGreaterThan(config.statement_timeout!);
    });
    it('rejects misspelled TLS settings and missing configured certificate files', () => {
        expect(() => databaseConfig({ POSTGRES_SSL: 'no-verify' })).toThrow();
        expect(() => databaseConfig({ POSTGRES_HOST: 'db.example.test', POSTGRES_CA_FILE: '/nonexistent/qsvc-ca.pem' })).toThrow();
    });
});
