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

export function withinSchedulingWindow(times: { scheduledStart: string }[], now = Date.now()): boolean {
    const latest = now + 3 * 86_400_000;
    return times.length > 0 && times.every(({ scheduledStart }) => {
        const start = Date.parse(scheduledStart);
        return start > now && start <= latest;
    });
}
