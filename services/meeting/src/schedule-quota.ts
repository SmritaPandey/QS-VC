export const WEEKLY_SCHEDULE_LIMIT = 7;

export async function reserveScheduleQuota(
    pool: { query(sql: string, values: unknown[]): Promise<{ rows: unknown[] }> },
    user: { sub: string; tenantId: string },
    count: number,
): Promise<boolean> {
    if (!Number.isInteger(count) || count < 1 || count > WEEKLY_SCHEDULE_LIMIT) return false;
    // The upsert locks the user's row, so simultaneous requests on different devices share a limit.
    const result = await pool.query(
        `INSERT INTO public.meeting_schedule_quota (user_id, tenant_id, issued_at)
         VALUES ($1, $2, array_fill(statement_timestamp(), ARRAY[$3::integer]))
         ON CONFLICT (user_id) DO UPDATE SET issued_at =
             ARRAY(SELECT stamp FROM unnest(meeting_schedule_quota.issued_at) AS stamp
                   WHERE stamp > statement_timestamp() - INTERVAL '168 hours') || EXCLUDED.issued_at
         WHERE (SELECT count(*) FROM unnest(meeting_schedule_quota.issued_at) AS stamp
                WHERE stamp > statement_timestamp() - INTERVAL '168 hours') + $3::integer <= $4::integer
         RETURNING user_id`,
        [user.sub, user.tenantId, count, WEEKLY_SCHEDULE_LIMIT],
    );
    return result.rows.length > 0;
}
