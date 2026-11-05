const { createHmac, timingSafeEqual } = require('node:crypto');

const DEVELOPMENT_SECRET = 'dev-jwt-secret-change-in-production';

function invitationSecret(secret = process.env.JWT_SECRET) {
    if (secret && secret !== DEVELOPMENT_SECRET) return secret;
    if (process.env.NODE_ENV === 'production') throw new Error('A private JWT_SECRET is required to create meeting invitations.');
    return secret || DEVELOPMENT_SECRET;
}

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
