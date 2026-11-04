import { it, expect } from 'vitest';
import { groupHosted, type HostedMeeting } from './HostedMeetings';

it('groups hosted meetings into live, upcoming and past', () => {
    const now = Date.parse('2026-11-04T10:00:00Z');
    const m = (id: string, status: string, start?: string): HostedMeeting => ({ id, meetingCode: id, title: id, status, scheduledStart: start, createdAt: '2026-11-01T00:00:00Z' });
    const { live, upcoming, past } = groupHosted([
        m('later', 'scheduled', '2026-11-06T10:00:00Z'), m('soon', 'scheduled', '2026-11-04T11:00:00Z'),
        m('live', 'active'), m('done', 'ended', '2026-11-03T10:00:00Z'), m('instant', 'waiting'), m('x', 'cancelled', '2026-11-05T10:00:00Z'),
    ], now);
    expect(live.map(x => x.id)).toEqual(['live']);
    expect(upcoming.map(x => x.id)).toEqual(['soon', 'later']);
    expect(past.map(x => x.id).sort()).toEqual(['done', 'instant']);
});
