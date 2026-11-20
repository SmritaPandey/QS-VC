import { expect, it } from 'vitest';
import { MEETING_FORMATS, roomFormat } from './meeting-formats';

it('keeps each format distinct and recognises legacy staged meetings', () => {
    expect(roomFormat({ meetingKind: 'webinar', webinar: true })).toBe('webinar');
    expect(roomFormat({ webinar: true })).toBe('town_hall');
    expect(roomFormat({ meetingKind: 'team' })).toBe('team');
    expect(roomFormat({ meetingKind: 'instant' })).toBe('instant');
    expect(MEETING_FORMATS.instant.layout).toBe('auto');
    expect(roomFormat()).toBe('conference');
    expect(MEETING_FORMATS.conference.actions).toContain('breakouts');
    expect(MEETING_FORMATS.team.actions).toContain('notes');
    expect(MEETING_FORMATS.webinar.actions).toContain('polls');
    expect(MEETING_FORMATS.town_hall.actions).toContain('host');
});
