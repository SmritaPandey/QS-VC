import { afterEach, expect, it, vi } from 'vitest';
import { readSessionMeetings, scheduledStarts, SCHEDULE_WINDOW_MS, writeSessionMeetings, type SessionMeeting } from './session-schedule';

afterEach(() => vi.unstubAllGlobals());

it('allows starts through the 72-hour boundary and rejects past starts and later occurrences', () => {
    const now = Date.parse('2026-11-19T06:00:00Z');
    expect(scheduledStarts(now + SCHEDULE_WINDOW_MS, 1, now)).toEqual(['2026-11-22T06:00:00.000Z']);
    expect(() => scheduledStarts(now + SCHEDULE_WINDOW_MS + 1, 1, now)).toThrow();
    expect(() => scheduledStarts(now, 1, now)).toThrow();
    expect(scheduledStarts(now + 60_000, 3, now)).toHaveLength(3);
    expect(() => scheduledStarts(now + 2 * 86_400_000, 3, now)).toThrow();
});

it('keeps the current tab’s schedule separate by signed-in account', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: storage.get.bind(storage), setItem: storage.set.bind(storage) });
    const meeting: SessionMeeting = { id: 'meeting-1', title: 'Team call', start: '2026-11-20T06:00:00Z', duration: 30, meetingKind: 'team', previewPath: '/meeting/QS-S-test/preview?invite=token' };
    writeSessionMeetings('one', [meeting]);
    expect(readSessionMeetings('one')).toEqual([meeting]);
    expect(readSessionMeetings('two')).toEqual([]);
    writeSessionMeetings('one', []);
    expect(readSessionMeetings('one')).toEqual([]);
});
