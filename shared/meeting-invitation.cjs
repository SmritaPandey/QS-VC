const { createHmac, timingSafeEqual } = require('node:crypto');

const { serviceSecret } = require('./service-secrets.cjs');

function invitationSecret(secret) { return secret || serviceSecret('INVITATION_SECRET'); }

function createMeetingInviteToken(meetingCode, secret) {
    return createHmac('sha256', invitationSecret(secret))
        .update(`qsvc:meeting-invite:${String(meetingCode).toUpperCase()}`)
        .digest('base64url');
}

function verifyMeetingInviteToken(meetingCode, token, secret) {
    if (typeof token !== 'string') return false;
    const expected = Buffer.from(createMeetingInviteToken(meetingCode, secret));
    const actual = Buffer.from(token);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

module.exports = { createMeetingInviteToken, verifyMeetingInviteToken };
