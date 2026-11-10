import { expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { endHostedMeeting } from './cancel-meeting.js';
import jwt from 'jsonwebtoken';
import { serviceSecret } from '../../../shared/service-secrets.cjs';

const id = 'd3c07384-d9a8-4efb-bac5-330ec380e919';
const tenantId = 'fa86926d-8590-4487-aa68-246e433c8f46';
const hostId = '8455d175-99a2-49ea-aafe-a92e8df3adca';
const serviceToken = () => jwt.sign({}, serviceSecret('MEETING_POLICY_SECRET'), { audience: 'qsvc-meeting-policy', issuer: 'qsvc-internal', expiresIn: 30 });
async function end(rows: unknown[], body: { hostId: string; tenantId: string; action?: 'end' | 'cancel' } = { hostId, tenantId }, token = serviceToken()) {
    const query = vi.fn().mockResolvedValue({ rows });
    const runWithTenant = vi.fn((_tenant: string, callback: () => unknown) => callback()) as any;
    const response = { status: vi.fn(), json: vi.fn() }; response.status.mockReturnValue(response);
    await endHostedMeeting({ query, runWithTenant })({ params: { code: 'ABC-123' }, headers: { authorization: `Bearer ${token}` }, body } as unknown as Request, response as unknown as Response);
    return { query, runWithTenant, response };
}

it('requires service authentication before allowing a dashboard end update', async () => {
    const { query, runWithTenant, response } = await end([], { hostId, tenantId }, 'forged-token');
    expect(query).not.toHaveBeenCalled(); expect(runWithTenant).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(401);
});

it('atomically checks persisted host, tenant and live status inside the verified tenant transaction', async () => {
    const { query, runWithTenant, response } = await end([{ id }]);
    expect(runWithTenant).toHaveBeenCalledWith(tenantId, expect.any(Function));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status IN ('active', 'ended')"), ['ABC-123', tenantId, hostId]);
    expect(query.mock.calls[0][0]).toContain('meeting_code = $1 AND tenant_id = $2 AND host_id = $3');
    expect(query.mock.calls[0][0]).toContain('actual_end = COALESCE(actual_end, NOW())');
    expect(response.json).toHaveBeenCalledWith({ updated: true });
});

it.each([
    { hostId: '1791f009-8215-4fbc-be7b-a982ced74b0e', tenantId },
    { hostId, tenantId: '8d35d42a-ddd9-444b-a4e7-b9b3a97925c5' },
])('does not confirm an end for a different persisted owner or tenant', async actor => {
    const { response, query } = await end([], actor);
    expect(query.mock.calls[0][1]).toEqual(['ABC-123', actor.tenantId, actor.hostId]);
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).not.toHaveBeenCalledWith({ updated: true });
});

it('validates service-supplied tenant and owner IDs before database access', async () => {
    const { query, response } = await end([], { hostId, tenantId: 'invalid' });
    expect(query).not.toHaveBeenCalled(); expect(response.status).toHaveBeenCalledWith(400);
});

it('confirms dashboard cancellation only for the persisted owner’s waiting instant link', async () => {
    const { query, runWithTenant, response } = await end([{ id }], { hostId, tenantId, action: 'cancel' });
    expect(runWithTenant).toHaveBeenCalledWith(tenantId, expect.any(Function));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SET status = 'cancelled'"), ['ABC-123', tenantId, hostId]);
    expect(query.mock.calls[0][0]).toContain('meeting_code = $1 AND tenant_id = $2 AND host_id = $3');
    expect(query.mock.calls[0][0]).toContain("type = 'instant' AND scheduled_start IS NULL AND status IN ('waiting', 'cancelled')");
    expect(response.json).toHaveBeenCalledWith({ updated: true });
});
it('does not confirm cancellation when the owner, tenant or waiting instant lifecycle guard fails', async () => {
    const { response } = await end([], { hostId, tenantId, action: 'cancel' });
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).not.toHaveBeenCalledWith({ updated: true });
});
