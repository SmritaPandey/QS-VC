export type MeetingKind = 'instant' | 'conference' | 'team' | 'town_hall' | 'webinar';

export function normalizeMeetingSettings(settings?: object) {
    const value = (settings || {}) as Record<string, unknown>;
    const meetingKind: MeetingKind = value.meetingKind === 'instant' || value.meetingKind === 'team' || value.meetingKind === 'town_hall' || value.meetingKind === 'webinar'
        ? value.meetingKind
        : value.meetingKind === 'conference' ? 'conference' : value.webinar === true ? 'town_hall' : 'conference';

    return {
        ...value,
        meetingKind,
        webinar: meetingKind === 'town_hall' || meetingKind === 'webinar',
        waitingRoom: true,
    };
}
