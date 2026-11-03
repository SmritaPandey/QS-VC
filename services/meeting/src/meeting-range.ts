/** Optional half-open timestamp range; legacy list callers can omit both values. */
export function meetingRange(start: unknown, end: unknown): { start: string; end: string } | null {
    if (start === undefined && end === undefined) return null;
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
    if (typeof start !== 'string' || typeof end !== 'string' || !iso.test(start) || !iso.test(end)) throw new Error('Invalid date range');
    const from = Date.parse(start), to = Date.parse(end);
    if (!Number.isFinite(from) || !Number.isFinite(to) || new Date(from).toISOString().slice(0,10) !== start.slice(0,10) || new Date(to).toISOString().slice(0,10) !== end.slice(0,10) || to <= from || to - from > 31 * 86400000) throw new Error('Invalid date range');
    return { start: new Date(from).toISOString(), end: new Date(to).toISOString() };
}
