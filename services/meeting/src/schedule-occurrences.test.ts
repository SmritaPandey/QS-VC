import { expect, it } from 'vitest';
import { scheduleOccurrences } from './schedule-occurrences';

it('preserves duration and the UTC time across a weekly series', () => {
    expect(scheduleOccurrences('2026-11-04T04:30:00Z', '2026-11-04T05:00:00Z', { frequency: 'weekly', count: 2 })).toEqual([
        { scheduledStart: '2026-11-04T04:30:00.000Z', scheduledEnd: '2026-11-04T05:00:00.000Z' },
        { scheduledStart: '2026-11-11T04:30:00.000Z', scheduledEnd: '2026-11-11T05:00:00.000Z' },
    ]);
    expect(scheduleOccurrences('2026-11-04T04:30:00Z', '2026-11-04T04:00:00Z')).toBeNull();
});
