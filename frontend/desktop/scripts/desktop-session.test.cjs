'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../dist/preload.js'), 'utf8');

function preload(pathname, marker = 'desktop-placeholder', protocol = 'https:') {
    const local = new Map([['token', 'old-browser-account']]);
    const session = new Map([['token', 'old-session']]);
    const calls = [];
    const storage = map => ({ removeItem: key => map.delete(key), setItem: (key, value) => map.set(key, value) });
    vm.runInNewContext(source, {
        exports: {}, process: { platform: 'linux' }, location: { pathname, protocol },
        localStorage: storage(local), sessionStorage: storage(session),
        require: name => {
            assert.equal(name, 'electron');
            return { contextBridge: { exposeInMainWorld() {} }, ipcRenderer: {
                sendSync: channel => { calls.push(channel); return marker; },
            } };
        },
    });
    return { local, session, calls };
}

for (const route of ['/admin', '/admin/', '/meeting/QS-ABCD-EFGH-IJKL/preview']) {
    test(`uses the current desktop account at ${route} without retaining a browser bearer`, () => {
        const { local, session, calls } = preload(route);
        assert.equal(local.has('token'), false);
        assert.equal(session.get('token'), 'desktop-placeholder');
        assert.deepEqual(calls, ['meeting:session-marker']);
    });
}
test('a frame denied by the main process receives no session token', () => {
    const { local, session } = preload('/admin', '');
    assert.equal(local.has('token'), false);
    assert.equal(session.has('token'), false);
});
test('other routes and the local app do not request a session marker', () => {
    for (const [route, protocol] of [['/login', 'https:'], ['/admin-lookalike', 'https:'], ['/static/app.html', 'file:']]) {
        const { calls } = preload(route, 'desktop-placeholder', protocol);
        assert.deepEqual(calls, []);
    }
});
