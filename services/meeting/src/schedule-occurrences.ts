export function scheduleOccurrences(start: string, end: string | undefined, recurrence?: { frequency: 'daily' | 'weekly'; count: number }) {
    const startMs = Date.parse(start);
    const endMs = end ? Date.parse(end) : null;
    if (!Number.isFinite(startMs) || (endMs !== null && (!Number.isFinite(endMs) || endMs <= startMs))) return null;
    const days = recurrence?.frequency === 'weekly' ? 7 : 1;
    return Array.from({ length: recurrence?.count ?? 1 }, (_, index) => {
        const offset = index * days * 86_400_000;
        return {
            scheduledStart: new Date(startMs + offset).toISOString(),
            scheduledEnd: endMs === null ? null : new Date(endMs + offset).toISOString(),
        };
    });
}

type Occurrence = NonNullable<ReturnType<typeof scheduleOccurrences>>[number] & { id: string; meetingCode: string };

export async function insertSchedule(
    db: { query(sql: string, values: unknown[]): Promise<unknown> },
    tenantId: string, title: string, hostId: string, type: 'scheduled' | 'recurring',
    settings: object, occurrences: Occurrence[],
) {
    await db.query(
        `INSERT INTO meetings (id, tenant_id, meeting_code, title, host_id, type, status, scheduled_start, scheduled_end, settings)
         SELECT x.id, $1, x."meetingCode", $2, $3, $4, 'waiting', x."scheduledStart", x."scheduledEnd", $5
         FROM jsonb_to_recordset($6::jsonb) AS x(
             id uuid, "meetingCode" text, "scheduledStart" timestamptz, "scheduledEnd" timestamptz
         )`,
        [tenantId, title, hostId, type, JSON.stringify(settings), JSON.stringify(occurrences)],
    );
}
