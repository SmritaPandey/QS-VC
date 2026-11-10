import { it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { groupHosted, HostedMeetingRow, type HostedMeeting } from './HostedMeetings';

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

it.each([
    ['waiting', undefined, 'Cancel meeting'],
    ['waiting', '2026-11-11T10:00:00Z', 'Cancel meeting'],
    ['active', undefined, 'End meeting'],
    ['active', '2026-11-11T10:00:00Z', 'End meeting'],
    ['ended', undefined, null],
])('offers the right action for %s meetings (scheduled start: %s)', (status, scheduledStart, action) => {
    const meeting: HostedMeeting = { id: 'meeting', meetingCode: 'ABC-123', title: 'Team call', status, scheduledStart, createdAt: '2026-11-10T10:00:00Z' };
    const oldWindow = globalThis.window;
    Object.assign(globalThis, { window: { location: { origin: 'https://example.com' } } });
    try {
        const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(HostedMeetingRow, {
            meeting, label: status, onCancelled: () => {}, onExpired: () => {},
        })));
        if (action) expect(html).toContain(`>${action}</button>`);
        else { expect(html).not.toContain('>End meeting</button>'); expect(html).not.toContain('>Cancel meeting</button>'); expect(html).toContain('Recordings'); }
    } finally { Object.assign(globalThis, { window: oldWindow }); }
});
