const DEFAULT_MEETING_PARTICIPANT_LIMIT = 500;
const DEFAULT_SIGNALING_PARTICIPANT_LIMIT = 1000;
const MAX_CONFIGURED_MEETING_PARTICIPANTS = 1500;

function meetingParticipantLimit(defaultLimit = DEFAULT_MEETING_PARTICIPANT_LIMIT, env = process.env) {
    const value = env.QSVC_MAX_MEETING_PARTICIPANTS;
    if (value === undefined || value === '') return defaultLimit;
    if (!/^[0-9]+$/.test(value) || Number(value) < 2 || Number(value) > MAX_CONFIGURED_MEETING_PARTICIPANTS) {
        throw new Error('QSVC_MAX_MEETING_PARTICIPANTS must be an integer from 2 to 1500.');
    }
    return Number(value);
}

module.exports = {
    DEFAULT_MEETING_PARTICIPANT_LIMIT,
    DEFAULT_SIGNALING_PARTICIPANT_LIMIT,
    MAX_CONFIGURED_MEETING_PARTICIPANTS,
    meetingParticipantLimit,
};
