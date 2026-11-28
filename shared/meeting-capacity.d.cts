export const DEFAULT_MEETING_PARTICIPANT_LIMIT: 500;
export const DEFAULT_SIGNALING_PARTICIPANT_LIMIT: 1000;
export const MAX_CONFIGURED_MEETING_PARTICIPANTS: 1500;
export function meetingParticipantLimit(defaultLimit?: number, env?: Record<string, string | undefined>): number;
