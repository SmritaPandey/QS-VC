const { readFileSync } = require('node:fs');
const { createPublicKey, verify } = require('node:crypto');
const { dirname, join } = require('node:path');
const duration = 14 * 24 * 60 * 60 * 1000;

function trialState(file = '/trial/installed-at', now = Date.now()) {
    try {
        const value = readFileSync(file, 'utf8').trim();
        if (!/^\d{13}$/.test(value)) return 'unavailable';
        const installed = Number(value);
        if (now < installed) return 'unavailable';
        if (now < installed + duration) return 'active';
        return licenseActive(dirname(file), now) ? 'active' : 'expired';
    } catch {
        return 'unavailable';
    }
}

function licenseActive(directory, now, publicKey = join(__dirname, 'license-public.pem')) {
    try {
        const installationId = readFileSync(join(directory, 'installation-id'), 'utf8').trim();
        const { payload, signature } = JSON.parse(readFileSync(join(directory, 'license.json'), 'utf8'));
        const key = createPublicKey(readFileSync(publicKey));
        if (key.asymmetricKeyType !== 'ed25519' || typeof payload !== 'string' || typeof signature !== 'string'
            || !verify(null, Buffer.from(payload), key, Buffer.from(signature, 'base64url'))) return false;
        const license = JSON.parse(payload);
        return license.purpose === 'qsvc-onprem-extension-v1'
            && license.installationId === installationId
            && Number.isSafeInteger(license.expiresAt) && now < license.expiresAt;
    } catch { return false; }
}

module.exports = { trialState, licenseActive };
