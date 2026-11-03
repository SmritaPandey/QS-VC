import { describe, it, expect, vi } from 'vitest';
import { tenantDatabase } from './tenant-database.cjs';
const a = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
function fixture(fail = false) {
    const client = { query: vi.fn(async (sql: string) => { if (fail && sql === 'SELECT data') throw new Error('query failed'); return { rows: [{ ok: true }] }; }), release: vi.fn() };
    const pool = { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn(async () => client) };
    return { client, pool, db: tenantDatabase(pool as any) };
}
describe('transaction-local tenant context', () => {
    it('sets tenant inside a transaction and releases only after commit', async () => {
        const { db, client } = fixture();
        await db.runWithTenant(a, () => db.query('SELECT data'));
        expect(client.query.mock.calls.map(call => call[0])).toEqual(['BEGIN', "SELECT set_config('app.current_tenant', $1, true)", 'SELECT data', 'COMMIT']);
        expect(client.query.mock.calls[1][1]).toEqual([a]);
        expect(client.release).toHaveBeenCalledWith(false);
    });
    it('rolls back and discards a failed transaction', async () => {
        const { db, client } = fixture(true);
        await expect(db.runWithTenant(a, () => db.query('SELECT data'))).rejects.toThrow('query failed');
        expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
        expect(client.release).toHaveBeenCalledWith(true);
    });
    it('does not leak tenant context to a later unscoped query', async () => {
        const { db, pool } = fixture();
        await db.runWithTenant(a, () => db.query('SELECT data'));
        await db.query('SELECT 1');
        expect(pool.query).toHaveBeenCalledWith('SELECT 1', undefined);
    });
    it('keeps concurrent request contexts separate', async () => {
        const { db, client } = fixture();
        await Promise.all([db.runWithTenant(a, async () => { await Promise.resolve(); return db.query('SELECT data'); }), db.runWithTenant(b, () => db.query('SELECT data'))]);
        expect(client.query.mock.calls.filter(call => call[0].includes('set_config')).map(call => call[1])).toEqual(expect.arrayContaining([[a], [b]]));
    });
    it('rejects an invalid tenant before acquiring a connection', () => {
        const { db, pool } = fixture();
        expect(() => db.runWithTenant('bad', () => db.query('SELECT data'))).toThrow('Invalid tenant');
        expect(pool.connect).not.toHaveBeenCalled();
    });
});
