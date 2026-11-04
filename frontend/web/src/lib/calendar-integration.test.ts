import { expect, it } from 'vitest';
import { generateICS } from './calendar-integration';

it('exports the scheduled UTC instant and escapes calendar property injection', () => {
    const calendar = generateICS({
        meetingCode: 'QS-TEST', title: 'Planning\r\nATTENDEE:mailto:unexpected@example.test',
        meetingUrl: 'https://meet.example.test/meeting/QS-TEST/preview',
        startTime: new Date('2026-11-04T10:00:00+05:30'),
        endTime: new Date('2026-11-04T10:30:00+05:30'),
        timezone: 'Asia/Kolkata', attendees: [], reminders: [], isPrivate: true,
    });
    expect(calendar).toContain('DTSTART:20261104T043000Z');
    expect(calendar).toContain('DTEND:20261104T050000Z');
    expect(calendar).toContain('SUMMARY:Planning\\nATTENDEE:');
    expect(calendar).not.toContain('\r\nATTENDEE:');
    expect(calendar).not.toContain('Quantum');
});
