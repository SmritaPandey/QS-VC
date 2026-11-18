import { expect, it } from 'vitest';
import { scheduleOccurrences, withinSchedulingWindow } from './schedule-occurrences';

it('preserves duration and the UTC time across a weekly series', () => {
    expect(scheduleOccurrences('2026-11-04T04:30:00Z', '2026-11-04T05:00:00Z', { frequency: 'weekly', count: 2 })).toEqual([
        { scheduledStart: '2026-11-04T04:30:00.000Z', scheduledEnd: '2026-11-04T05:00:00.000Z' },
        { scheduledStart: '2026-11-11T04:30:00.000Z', scheduledEnd: '2026-11-11T05:00:00.000Z' },
    ]);
    expect(scheduleOccurrences('2026-11-04T04:30:00Z', '2026-11-04T04:00:00Z')).toBeNull();
});

it('requires every occurrence to start within the rolling 72-hour window', () => {
    const now = Date.parse('2026-11-19T06:00:00Z');
    expect(withinSchedulingWindow([{ scheduledStart: '2026-11-22T06:00:00Z' }], now)).toBe(true);
    expect(withinSchedulingWindow([{ scheduledStart: '2026-11-19T06:00:00Z' }], now)).toBe(false);
    expect(withinSchedulingWindow(scheduleOccurrences('2026-11-21T07:00:00Z', undefined, { frequency: 'daily', count: 2 })!, now)).toBe(false);
});
