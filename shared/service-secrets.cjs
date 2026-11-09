const DEVELOPMENT = {
    TURN_ACCESS_SECRET: 'qsvc-local-turn-access-only-32-bytes',
    INTERNAL_AUTH_SECRET: 'qsvc-local-auth-verify-only-32-bytes',
    MEETING_POLICY_SECRET: 'qsvc-local-meeting-policy-only-32-bytes',
    INVITATION_SECRET: 'qsvc-local-invitation-only-32-bytes',
};
function serviceSecret(name, env = process.env) {
    if (!Object.hasOwn(DEVELOPMENT, name)) throw new Error('Unknown service secret purpose');
    const value = env[name]?.trim();
    if (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') return value || DEVELOPMENT[name];
    if (!value || Buffer.byteLength(value) < 32 || Object.values(DEVELOPMENT).includes(value) || value === env.JWT_SECRET || Object.keys(DEVELOPMENT).some(other => other !== name && value === env[other]?.trim())) {
        throw new Error(`${name} must be a distinct private secret of at least 32 bytes.`);
    }
    return value;
}
module.exports = { serviceSecret };
