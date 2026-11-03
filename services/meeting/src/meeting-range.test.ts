import { describe, it, expect } from 'vitest';
import { meetingRange } from './meeting-range.js';
describe('meeting calendar range', () => {
    it('preserves legacy list calls', () => expect(meetingRange(undefined, undefined)).toBeNull());
    it('accepts a UTC interval representing an Indian local day', () => {
        expect(meetingRange('2026-11-01T18:30:00.000Z', '2026-11-02T18:30:00.000Z')).toEqual({ start:'2026-11-01T18:30:00.000Z', end:'2026-11-02T18:30:00.000Z' });
    });
    it.each([[undefined,'2026-11-02T00:00:00Z'], ['bad','bad'], ['2026-11-02T00:00:00Z','2026-11-01T00:00:00Z'], ['2026-11-01T00:00:00Z','2026-12-04T00:00:00Z'], [[],[]], ['2026-02-31T00:00:00Z','2026-03-05T00:00:00Z']])('rejects incomplete, malformed or oversized ranges', (start,end) => expect(() => meetingRange(start,end)).toThrow());
});
