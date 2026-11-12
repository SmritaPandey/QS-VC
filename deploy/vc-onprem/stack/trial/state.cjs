const { readFileSync } = require('node:fs');
const duration = 14 * 24 * 60 * 60 * 1000;

function trialState(file = '/trial/installed-at', now = Date.now()) {
    try {
        const value = readFileSync(file, 'utf8').trim();
        if (!/^\d{13}$/.test(value)) return 'unavailable';
        const installed = Number(value);
        if (now < installed) return 'unavailable';
        return now >= installed + duration ? 'expired' : 'active';
    } catch {
        return 'unavailable';
    }
}

module.exports = { trialState };
