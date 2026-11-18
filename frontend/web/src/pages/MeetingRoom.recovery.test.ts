import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import ts from 'typescript';

const source = ts.createSourceFile('MeetingRoom.tsx', readFileSync(new URL('./MeetingRoom.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function recovery(reconnecting: boolean) {
    let callback = '';
    function visit(node: ts.Node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'dropped') callback = node.initializer!.getText(source);
        ts.forEachChild(node, visit);
    }
    visit(source);
    const context = {
        reconnecting, mounted: true, settleAdmission: vi.fn(), audioMutedRef: { current: true }, videoOffRef: { current: true },
        stopLocalMedia: vi.fn(), media: { close: vi.fn() }, signaling: { disconnect: vi.fn() },
        setConnected: vi.fn(), setPeers: vi.fn(), setLocalStream: vi.fn(), setVideoOff: vi.fn(), setAudioMuted: vi.fn(),
        onDropped: vi.fn(() => true), setRestoring: vi.fn(), setConnectionLost: vi.fn(),
    };
    const body = ts.transpileModule(`let recoveryStarted = false; return (${callback});`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    return { context, drop: new Function(...Object.keys(context), body)(...Object.values(context)) };
}
it('initial join failure schedules one retry even if both socket and join reject, without claiming reconnection', () => {
    const { context, drop } = recovery(false);
    drop(); drop();
    expect(context.onDropped).toHaveBeenCalledTimes(1);
    expect(context.settleAdmission).toHaveBeenCalledWith({ cancelled: true });
    expect(context.setRestoring).toHaveBeenCalledWith(false);
    expect(context.media.close).toHaveBeenCalledTimes(1);
});
it('an established-session drop uses reconnecting state', () => {
    const { context, drop } = recovery(true);
    drop();
    expect(context.setRestoring).toHaveBeenCalledWith(true);
});
