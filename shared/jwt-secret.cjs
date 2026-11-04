const developmentSecret = 'dev-jwt-secret-change-in-production';

function assertJwtSecret(env = process.env) {
    if (env.NODE_ENV !== 'production') return;
    const secret = env.JWT_SECRET?.trim();
    if (!secret || secret === developmentSecret || Buffer.byteLength(secret) < 32) {
        throw new Error('Production requires a private JWT_SECRET of at least 32 bytes.');
    }
}

module.exports = { assertJwtSecret };
