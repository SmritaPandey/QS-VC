const test = require('node:test');
const assert = require('node:assert/strict');
const { assess } = require('./check.cjs');

const date = '2025-01-01T00:00:00Z';
const now = Date.parse('2025-02-01T00:00:00Z');
const finding = { id: 'fixture', asset: 'auth', deployment: 'intranet', status: 'reproduced', evidence: 'fixture-run', reproducedBy: 'tester', reproducedOn: date };
const evidence = { id: 'fixture-run', deployment: 'intranet', revision: 'fixture', artifact: 'test.log', collectedBy: 'tester', collectedOn: date, result: 'pass', reviewedBy: 'reviewer' };
const vector = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N';

test('keeps deployments separate and never infers conformity from entries', () => {
    const result = assess([{ ...finding, vector }], [evidence], now);
    assert.equal(result.intranet.reproduced, 1);
    assert.equal(result.intranet.evidenceEntries, 1);
    assert.equal(result.public.evidenceEntries, 0);
    assert.equal(result.intranet.conformity, 'unverified');
});

test('rejects unscoped or duplicated entries', () => {
    assert.throws(() => assess([{ ...finding, deployment: 'both' }], [], now));
    assert.throws(() => assess([finding, finding], [], now));
    assert.throws(() => assess([], [evidence, evidence], now));
});

test('requires reproduction before a v4.0 Base vector and rejects future evidence', () => {
    assert.throws(() => assess([{ ...finding, status: 'candidate', vector }], [], now));
    assert.throws(() => assess([{ ...finding, evidence: '', vector }], [], now));
    assert.throws(() => assess([{ ...finding, vector: 'CVSS:3.1/AV:N' }], [], now));
    assert.throws(() => assess([], [{ ...evidence, collectedOn: '2027-01-01' }], now));
});

test('rejects self-review even when case or whitespace differs', () => {
    assert.throws(() => assess([], [{ ...evidence, reviewedBy: ' TESTER ' }], now), /separate reviewer/);
});
