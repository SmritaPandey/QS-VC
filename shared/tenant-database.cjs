const { AsyncLocalStorage } = require('node:async_hooks');
function tenantDatabase(pool) {
    const context = new AsyncLocalStorage();
    return {
        runWithTenant(tenantId, action) {
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) throw new Error('Invalid tenant');
            return context.run(tenantId, action);
        },
        async query(sql, values) {
            const tenantId = context.getStore();
            if (!tenantId) return pool.query(sql, values);
            const client = await pool.connect();
            let discard = false;
            try {
                await client.query('BEGIN');
                await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
                const result = await client.query(sql, values);
                await client.query('COMMIT');
                return result;
            } catch (error) {
                discard = true;
                try { await client.query('ROLLBACK'); } catch { /* Discard the broken connection. */ }
                throw error;
            } finally { client.release(discard); }
        },
    };
}
module.exports = { tenantDatabase };
