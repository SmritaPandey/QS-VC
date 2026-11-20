import express from 'express';
import { expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { planMeetingAdmins } from './plan-meeting-admins.js';

it('restricts unlimited role assignments and revocations to the verified plan owner', async () => {
    const owner = 'f4100ef2-8d7e-4cb0-a07c-7484ac1f4cfa';
    const delegate = '0d9ca879-c281-416d-93d3-0a4041defcb6';
    const tenantId = '9b987977-5835-416a-a8dd-cd3b8ece87d1';
    const query = vi.fn(async (sql: string, params: unknown[]) => ({
        rows: sql.includes('SELECT 1') && params[0] !== owner ? [] : [{ delegate_id: delegate }],
    }));
    const app = express();
    app.use(express.json(), planMeetingAdmins({ query } as unknown as Pool, async sub => ({ sub, tenantId })));
    const server = app.listen(0, '127.0.0.1');
    try {
        await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing listener');
        const request = (method: string, sub: string, path = '/', body?: object) => fetch(`http://127.0.0.1:${address.port}${path}`, {
            method, headers: { Authorization: `Bearer ${sub}`, 'Content-Type': 'application/json' },
            body: body && JSON.stringify(body),
        });
        const grant = { email: 'delegate@example.com', role: 'admin' };
        expect((await request('PUT', delegate, '/', grant)).status).toBe(403);
        expect((await request('PUT', owner, '/', { ...grant, ownerId: delegate })).status).toBe(400);
        expect((await request('PUT', owner, '/', grant)).status).toBe(204);
        expect((await request('PUT', owner, '/', { ...grant, role: 'co_admin' })).status).toBe(204);
        expect(query).toHaveBeenCalledWith(expect.stringContaining('u.tenant_id = owner.tenant_id'), [owner, tenantId, grant.email, 'admin']);
        expect(query).toHaveBeenCalledWith(expect.stringContaining('DO UPDATE SET role'), [owner, tenantId, grant.email, 'co_admin']);
        expect((await request('DELETE', owner, `/${delegate}`)).status).toBe(204);
        expect(query).toHaveBeenLastCalledWith(expect.stringContaining('owner_id = $1 AND tenant_id = $2 AND delegate_id = $3'), [owner, tenantId, delegate]);
    } finally {
        if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    }
});
