interface SessionMeetingClaims {
    hostId: string;
    expiresAt: number;
    meetingKind: 'conference' | 'team' | 'town_hall' | 'webinar';
    e2eeRequired: boolean;
    maxParticipants: number;
}
declare const meetingInvitation: {
    createMeetingInviteToken(meetingCode: string, secret?: string): string;
    createGuestHostToken(meetingCode: string): string;
    verifyGuestHostToken(meetingCode: string, token: unknown): boolean;
    isSessionMeetingCode(meetingCode: string): boolean;
    createSessionMeetingInvite(meetingCode: string, claims: SessionMeetingClaims, secret?: string): string;
    verifySessionMeetingInvite(meetingCode: string, token: unknown, now?: number, secret?: string): SessionMeetingClaims | null;
    verifyMeetingInviteToken(meetingCode: string, token: unknown, secret?: string): boolean;
};
export = meetingInvitation;
