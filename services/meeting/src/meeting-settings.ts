export type MeetingKind = 'conference' | 'team' | 'town_hall';

export function normalizeMeetingSettings(settings?: object) {
    const value = (settings || {}) as Record<string, unknown>;
    const meetingKind: MeetingKind = value.meetingKind === 'team' || value.meetingKind === 'town_hall'
        ? value.meetingKind
        : value.meetingKind === 'conference' ? 'conference' : value.webinar === true ? 'town_hall' : 'conference';

    return {
        ...value,
        meetingKind,
        webinar: meetingKind === 'town_hall',
        waitingRoom: true,
    };
}
