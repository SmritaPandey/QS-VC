import type { MeetingSetup } from '../components/MeetingSetupDialog';

export function meetingsEndpoint(apiBase: string): string {
    const base = apiBase.replace(/\/+$/, '');
    return base.endsWith('/api/meetings') ? base : `${base}/api/meetings`;
}

export function authenticatedMeetingRequest(token: string, setup: MeetingSetup): RequestInit {
    return {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
            title: setup.title,
            type: 'instant',
            settings: {
                meetingKind: setup.meetingKind,
                webinar: setup.meetingKind === 'town_hall',
                waitingRoom: true,
            },
        }),
    };
}
