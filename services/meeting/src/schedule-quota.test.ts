import { expect, it, vi } from 'vitest';
import { reserveScheduleQuota } from './schedule-quota';

const user = { sub: 'one-account', tenantId: 'workspace' };

it('counts each occurrence against one account and accepts only a reservation granted by the database', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ user_id: user.sub }] }).mockResolvedValueOnce({ rows: [] });
    expect(await reserveScheduleQuota({ query }, user, 7)).toBe(true);
    expect(await reserveScheduleQuota({ query }, user, 1)).toBe(false);
    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining("INTERVAL '168 hours'"), ['one-account', 'workspace', 7, 7]);
    expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('ON CONFLICT (user_id)'), ['one-account', 'workspace', 1, 7]);
    expect(await reserveScheduleQuota({ query }, user, 8)).toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
});
