const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { trialState } = require('./state.cjs');

test('native trial directory preserves active, expired and fail-closed checks', () => {
    const directory = mkdtempSync(join(tmpdir(), 'qsvc-native-trial-'));
    const previous = process.env.QSVC_TRIAL_DIR;
    process.env.QSVC_TRIAL_DIR = directory;
    try {
        assert.equal(trialState(), 'unavailable');
        const now = Date.now();
        writeFileSync(join(directory, 'installed-at'), String(now));
        assert.equal(trialState(undefined, now), 'active');
        assert.equal(trialState(undefined, now - 1), 'unavailable');
        assert.equal(trialState(undefined, now + 14 * 86400000), 'expired');
        writeFileSync(join(directory, 'installed-at'), 'invalid');
        assert.equal(trialState(), 'unavailable');
    } finally {
        if (previous === undefined) delete process.env.QSVC_TRIAL_DIR;
        else process.env.QSVC_TRIAL_DIR = previous;
        rmSync(directory, { recursive: true, force: true });
    }
});
