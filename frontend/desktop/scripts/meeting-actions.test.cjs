'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { changeHostedMeeting } = require('../dist/meeting-actions.js');

function fixture(t, action = 'end', url = 'wss://meet.internal/ws') {
    const original = globalThis.WebSocket;
    let socket;
    class FakeSocket {
        messages = [];
        closed = false;
        constructor(url) { this.url = url; socket = this; }
        send(message) { this.messages.push(JSON.parse(message)); }
        close() { this.closed = true; }
        message(value) { this.onmessage({ data: JSON.stringify(value) }); }
    }
    globalThis.WebSocket = FakeSocket;
    t.after(() => { globalThis.WebSocket = original; });
    const controller = new AbortController();
    let current = true;
    const result = changeHostedMeeting({ url, ticket: 'single-use-ticket',
        meetingCode: 'QS-ABCD-EFGH-IJKL', action, signal: controller.signal, isCurrent: () => current });
    return { socket, result, controller, changeSession: () => { current = false; },
        authenticate: () => { socket.onopen(); socket.message({ id: 0, result: { authenticated: true } }); } };
}

for (const url of ['wss://meet.internal/ws', 'wss://qsvcmeet.com/ws'])
for (const action of ['end', 'cancel']) test(`${action} authenticates with a ticket at ${url} and waits for acknowledgement`, async t => {
    const { socket, result, authenticate } = fixture(t, action, url);
    authenticate();
    assert.equal(socket.url, url);
    assert.deepEqual(socket.messages.map(message => message.method), ['authenticate', 'endHostedMeeting']);
    assert.deepEqual(socket.messages[0].params, { ticket: 'single-use-ticket' });
    assert.deepEqual(socket.messages[1].params, { meetingCode: 'QS-ABCD-EFGH-IJKL', action });
    socket.message({ id: 1, result: action === 'end' ? { ended: true } : { cancelled: true } });
    await result;
    assert.equal(socket.closed, true);
});

test('authentication failure cannot send a meeting change', async t => {
    const { socket, result } = fixture(t);
    socket.onopen();
    socket.message({ id: 0, error: { message: 'Invalid ticket' } });
    await assert.rejects(result, /Authentication failed/);
    assert.equal(socket.messages.length, 1);
    assert.equal(socket.closed, true);
});

test('permission failure is not reported as success', async t => {
    const { socket, result, authenticate } = fixture(t);
    authenticate();
    socket.message({ id: 1, error: { message: 'Only the organiser' } });
    await assert.rejects(result, /not confirmed/);
});

test('a success message before authentication is rejected', async t => {
    const { socket, result } = fixture(t);
    socket.message({ id: 1, result: { ended: true } });
    await assert.rejects(result, /not confirmed/);
});

test('wrong action acknowledgement is rejected', async t => {
    const { socket, result, authenticate } = fixture(t, 'cancel');
    authenticate();
    socket.message({ id: 1, result: { ended: true } });
    await assert.rejects(result, /not confirmed/);
});

test('session changes prevent the destructive request', async t => {
    const { socket, result, changeSession } = fixture(t);
    socket.onopen();
    changeSession();
    socket.message({ id: 0, result: { authenticated: true } });
    await assert.rejects(result, /Session changed/);
    assert.equal(socket.messages.length, 1);
});

test('timeout closes the socket and ignores late authentication', async t => {
    const { socket, result, controller } = fixture(t);
    controller.abort();
    socket.onopen();
    await assert.rejects(result, /timed out/);
    assert.equal(socket.closed, true);
    assert.equal(socket.messages.length, 0);
});

test('disconnect before acknowledgement is not success', async t => {
    const { socket, result, authenticate } = fixture(t);
    authenticate();
    socket.onclose();
    await assert.rejects(result, /before confirmation/);
});
