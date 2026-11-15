import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import ts from 'typescript';

const source = ts.createSourceFile('MeetingRoom.tsx', readFileSync(new URL('./MeetingRoom.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let chatCallback = '';
function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'signaling.on' && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'chatMessage') chatCallback = node.arguments[1].getText(source);
    ts.forEachChild(node, visit);
}
visit(source);
function chatHarness(open = false) {
    let now = 0;
    const messages: unknown[] = [];
    const context = {
        alive: () => true, joinResult: { settings: { e2eeRequired: false } }, showNotice: vi.fn(),
        seenChatMessages: { current: new Set<string>() }, myPeerIdRef: { current: 'me' }, chatOpenRef: { current: open },
        setChatMessages: (update: (previous: unknown[]) => unknown[]) => { messages.splice(0, messages.length, ...update(messages)); },
        setIncomingChatMessage: vi.fn(), lastChatSound: { current: -Infinity }, playSound: vi.fn(), performance: { now: () => now },
    };
    if (!chatCallback) throw new Error('Missing chat event');
    const js = ts.transpileModule(`return (${chatCallback});`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    const receive = new Function(...Object.keys(context), js)(...Object.values(context));
    return { context, messages, receive, advance: (ms: number) => { now += ms; } };
}
it('sounds and flashes remote messages once, coalesces burst sounds, and preserves the chat history', () => {
    const h = chatHarness();
    const first = { id: '1', peerId: 'other', displayName: 'Sam', content: 'Hello' };
    h.receive(first); h.receive(first);
    h.receive({ ...first, id: '2', content: 'One more thing' });
    expect(h.messages).toHaveLength(2);
    expect(h.context.playSound).toHaveBeenCalledTimes(1);
    expect(h.context.setIncomingChatMessage).toHaveBeenLastCalledWith(expect.objectContaining({ id: '2' }));
    h.advance(1500); h.receive({ ...first, id: '3' });
    expect(h.context.playSound).toHaveBeenCalledTimes(2);
    h.receive({ ...first, id: 'mine', peerId: 'me' });
    expect(h.context.playSound).toHaveBeenCalledTimes(2);
    expect(h.messages).toHaveLength(4);
});
it('sounds a remote message with chat open without adding a duplicate flash', () => {
    const h = chatHarness(true);
    h.receive({ id: '1', peerId: 'other', displayName: 'Sam', content: 'Hello' });
    expect(h.context.playSound).toHaveBeenCalledWith('notice');
    expect(h.context.setIncomingChatMessage).not.toHaveBeenCalled();
});
