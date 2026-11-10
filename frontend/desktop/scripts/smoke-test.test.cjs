'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { runSmokeTest } = require('./smoke-test.cjs');

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qsvc-smoke-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const resultFile = path.join(directory, 'result.txt');
    return { resultFile, run: (script, timeout) => runSmokeTest(resultFile, process.execPath, ['-e', script], timeout) };
}

const writeResult = (value) => `require('node:fs').writeFileSync(process.env.QSVC_SMOKE_TEST, ${JSON.stringify(value)});`;

test('accepts a successful packaged-app result', (t) => {
    const { run } = fixture(t);
    assert.equal(run(writeResult('OK')).ok, true);
});

test('rejects an app that exits without rendering', (t) => {
    const { run } = fixture(t);
    assert.match(run('').message, /without confirming/);
});

test('removes a stale successful result before launching', (t) => {
    const { resultFile, run } = fixture(t);
    fs.writeFileSync(resultFile, 'OK');
    assert.equal(run('').ok, false);
    assert.equal(fs.existsSync(resultFile), false);
});

test('rejects a failed or empty start page result', (t) => {
    const { run } = fixture(t);
    assert.equal(run(writeResult('FAIL empty start page')).ok, false);
    assert.equal(run(writeResult('')).ok, false);
});

test('rejects a crash even if the app wrote a successful result', (t) => {
    const { run } = fixture(t);
    const result = run(`${writeResult('OK')} process.exit(2);`);
    assert.equal(result.ok, false);
    assert.match(result.message, /code 2/);
});

test('reports a missing executable', (t) => {
    const { resultFile } = fixture(t);
    const result = runSmokeTest(resultFile, path.join(path.dirname(resultFile), 'missing-app'));
    assert.equal(result.ok, false);
    assert.match(result.message, /Could not start app/);
});

test('terminates an app that never completes startup', (t) => {
    const { run } = fixture(t);
    const result = run('setInterval(() => {}, 1000);', 150);
    assert.equal(result.ok, false);
    assert.match(result.message, /timed out/);
});
