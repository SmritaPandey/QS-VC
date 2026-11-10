'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { isDesktopSessionPage } = require('../dist/desktop-navigation.js');

for (const origin of ['https://qsvcmeet.com', 'https://meet.internal']) {
    test(`permits only approved admin sessions at ${origin}/admin`, () => {
        assert.equal(isDesktopSessionPage(`${origin}/admin`, origin, true), true);
        assert.equal(isDesktopSessionPage(`${origin}/admin/`, origin, true), true);
        assert.equal(isDesktopSessionPage(`${origin}/admin`, origin, false), false);
        assert.equal(isDesktopSessionPage(`${origin}/admin/users`, origin, true), false);
        assert.equal(isDesktopSessionPage(`${origin}/admin-lookalike`, origin, true), false);
    });
    test(`preserves meeting sessions at ${origin}`, () => {
        assert.equal(isDesktopSessionPage(`${origin}/meeting/QS-ABCD-EFGH-IJKL/preview`, origin, false), true);
        assert.equal(isDesktopSessionPage(`${origin}/meeting/QS-ABCD-EFGH-IJKL`, origin, false), true);
        assert.equal(isDesktopSessionPage(`${origin}/login`, origin, true), false);
    });
}
test('never grants a session to another origin, embedded URL credentials or malformed URLs', () => {
    assert.equal(isDesktopSessionPage('https://attacker.test/admin', 'https://meet.internal', true), false);
    assert.equal(isDesktopSessionPage('https://meet.internal.attacker.test/admin', 'https://meet.internal', true), false);
    assert.equal(isDesktopSessionPage('https://user:password@meet.internal/admin', 'https://meet.internal', true), false);
    assert.equal(isDesktopSessionPage('file:///admin', 'https://meet.internal', true), false);
    assert.equal(isDesktopSessionPage('invalid', 'https://meet.internal', true), false);
});
