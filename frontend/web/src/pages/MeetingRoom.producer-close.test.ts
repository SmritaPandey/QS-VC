import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import ts from 'typescript';

const source = ts.createSourceFile('MeetingRoom.tsx', readFileSync(new URL('./MeetingRoom.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function listener(event: string, context: Record<string, unknown>) {
    let callback = '';
    function visit(node: ts.Node) {
        if (ts.isCallExpression(node) && node.expression.getText(source) === 'signaling.on' && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === event) callback = node.arguments[1].getText(source);
        ts.forEachChild(node, visit);
    }
    visit(source);
    if (!callback) throw new Error(`Missing ${event} listener`);
    const js = ts.transpileModule(`return (${callback});`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    return new Function(...Object.keys(context), js)(...Object.values(context));
}
it('removes a closed producer from queued consumption and closes its receiving track', () => {
    const pendingProducers = new Map([['screen', 'presenter'], ['camera', 'presenter']]);
    const consumingProducers = new Set(['screen', 'camera']);
    const media = { closeConsumerByProducer: vi.fn() };
    listener('producerClosed', { pendingProducers, consumingProducers, media })({ producerId: 'screen' });
    expect(pendingProducers.has('screen')).toBe(false);
    expect(consumingProducers.has('screen')).toBe(false);
    expect(pendingProducers.get('camera')).toBe('presenter');
    expect(consumingProducers.has('camera')).toBe(true);
    expect(media.closeConsumerByProducer).toHaveBeenCalledWith('screen');
});
it('clears the screen tile when an older server only reports presentation ending', () => {
    const patchPeer = vi.fn();
    const presenterUpdates = new Map();
    listener('presenterChanged', { myPeerIdRef: { current: 'viewer' }, presenterUpdates, peerSnapshotReady: true, patchPeer, playSound: vi.fn() })({ peerId: 'presenter', presenting: false });
    expect(presenterUpdates.get('presenter')).toBe(false);
    expect(patchPeer).toHaveBeenCalledWith('presenter', { presenting: false, screenVideoTrack: undefined });
});
