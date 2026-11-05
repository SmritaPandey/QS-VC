declare const meetingInvitation: {
    createMeetingInviteToken(meetingCode: string, secret?: string): string;
    verifyMeetingInviteToken(meetingCode: string, token: unknown, secret?: string): boolean;
};
export = meetingInvitation;
