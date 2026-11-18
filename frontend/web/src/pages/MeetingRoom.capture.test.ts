import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import ts from 'typescript';
it('joins with the acquired microphone when camera stalls and releases a late camera', async () => {
    vi.useFakeTimers();
    try {
        const source = ts.createSourceFile('MeetingRoom.tsx', readFileSync(new URL('./MeetingRoom.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const node = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'openLocalMedia')!;
        const body = ts.transpileModule(`${node.getText(source)}; return openLocalMedia;`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
        const mic = { stop: vi.fn() }, cameraTrack = { stop: vi.fn() };
        let cameraReady!: (value: unknown) => void;
        const open = new Function('openMicrophone', 'startCameraWithFallback', 'deviceLabel', 'microphoneMessage', 'cameraAccessMessage', body)(
            async () => ({ stream: { getTracks: () => [mic] }, fellBack: false }),
            () => new Promise(resolve => { cameraReady = resolve; }), () => 'device', () => 'mic error', () => 'camera error',
        );
        const stream = { addTrack: vi.fn() };
        const joining = open(undefined, undefined, {}, stream, () => true, () => true, () => true);
        await vi.advanceTimersByTimeAsync(5000);
        expect((await joining).cameraNotice).toContain('taking longer');
        expect(stream.addTrack).toHaveBeenCalledWith(mic);
        cameraReady({ track: cameraTrack, fellBack: false });
        await Promise.resolve(); await Promise.resolve();
        expect(cameraTrack.stop).toHaveBeenCalledOnce();
        expect(stream.addTrack).not.toHaveBeenCalledWith(cameraTrack);
    } finally { vi.useRealTimers(); }
});
