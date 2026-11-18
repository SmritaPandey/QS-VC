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

function isSessionMeetingCode(meetingCode) {
    return /^QS-S-[0-9A-F]{24}$/i.test(meetingCode);
}

function sessionSignature(meetingCode, payload, secret) {
    return createHmac('sha256', invitationSecret(secret))
        .update(`qsvc:session-schedule:${meetingCode.toUpperCase()}:${payload}`)
        .digest('base64url');
}

function createSessionMeetingInvite(meetingCode, claims, secret) {
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `${payload}.${sessionSignature(meetingCode, payload, secret)}`;
}

function verifySessionMeetingInvite(meetingCode, token, now = Date.now(), secret) {
    if (!isSessionMeetingCode(meetingCode) || typeof token !== 'string' || token.length > 512) return null;
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra !== undefined) return null;
    const actual = Buffer.from(signature);
    const expected = Buffer.from(sessionSignature(meetingCode, payload, secret));
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

    try {
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (typeof claims.hostId !== 'string' || !claims.hostId || !Number.isSafeInteger(claims.expiresAt) || claims.expiresAt <= now ||
            !['conference', 'team', 'town_hall'].includes(claims.meetingKind) || typeof claims.e2eeRequired !== 'boolean' ||
            !Number.isInteger(claims.maxParticipants) || claims.maxParticipants < 2 || claims.maxParticipants > 500) return null;
        return claims;
    } catch {
        return null;
    }
}

module.exports = { createMeetingInviteToken, verifyMeetingInviteToken, isSessionMeetingCode, createSessionMeetingInvite, verifySessionMeetingInvite };
