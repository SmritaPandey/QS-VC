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
it('removes departed peers and closes queued and active consumers before late tracks can restore them', () => {
    const departedPeers = new Set<string>();
    const pendingProducers = new Map([['pending', 'gone'], ['other', 'stays']]);
    const media = { getConsumers: () => [{ peerId: 'gone', producerId: 'active' }], closeConsumerByProducer: vi.fn() };
    let peers = new Map([['gone', {}], ['stays', {}]]);
    listener('peerLeft', {
        departedPeers, pendingProducers, media, presenterUpdates: new Map([['gone', true]]),
        notifiedKnocks: { current: new Set() }, e2eeBundlesRef: { current: new Map() }, bumpE2EEIdentities: vi.fn(),
        setKnocks: vi.fn(), setPeers: (update: (value: typeof peers) => typeof peers) => { peers = update(peers); },
        e2eeKeyHolderRef: { current: null }, myPeerIdRef: { current: 'self' }, lastHolderHandoverFrom: { current: null },
    })({ peerId: 'gone' });
    expect(departedPeers.has('gone')).toBe(true);
    expect(peers.has('gone')).toBe(false);
    expect(peers.has('stays')).toBe(true);
    expect(pendingProducers.has('pending')).toBe(false);
    expect(media.closeConsumerByProducer.mock.calls).toEqual([['pending'], ['active']]);
});
