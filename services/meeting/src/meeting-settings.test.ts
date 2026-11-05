import { describe, expect, it } from 'vitest';
import { normalizeMeetingSettings } from './meeting-settings.js';

describe('normalizeMeetingSettings', () => {
    it('uses conferencing as the default and always requires host admission', () => {
        expect(normalizeMeetingSettings({ waitingRoom: false })).toMatchObject({
            meetingKind: 'conference', webinar: false, waitingRoom: true,
        });
    });

    it('keeps meeting kind independent and maps town halls to webinar behavior', () => {
        expect(normalizeMeetingSettings({ meetingKind: 'team', webinar: true })).toMatchObject({
            meetingKind: 'team', webinar: false, waitingRoom: true,
        });
        expect(normalizeMeetingSettings({ meetingKind: 'town_hall', webinar: false })).toMatchObject({
            meetingKind: 'town_hall', webinar: true, waitingRoom: true,
        });
    });

    it('keeps legacy webinar meetings as town halls', () => {
        expect(normalizeMeetingSettings({ webinar: true })).toMatchObject({ meetingKind: 'town_hall', webinar: true });
    });
});
