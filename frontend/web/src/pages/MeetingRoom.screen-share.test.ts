import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

// Exercise the page's callbacks without mounting its meeting/network setup effects.
const source = ts.createSourceFile('MeetingRoom.tsx', readFileSync(new URL('./MeetingRoom.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map<string, string>();
let banner = '';
function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ['startScreenShare', 'stopScreenShare', 'togglePauseScreenShare'].includes(node.name.getText(source))) {
        declarations.set(node.name.getText(source), `const ${node.getText(source)};`);
    }
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(property => ts.isJsxAttribute(property) && property.name.getText(source) === 'className' && property.initializer?.getText(source) === '"presenting-banner"')) banner = node.getText(source);
    ts.forEachChild(node, visit);
}
visit(source);
const compile = (code: string) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React } }).outputText;
const bindActions = new Function('context', compile(`
    const { useCallback, sharingRef, sessionRevision, sessionActive, screenStreamRef, joinedRef,
        roomSettingsRef, busyRef, initializingRef, media, navigator, signaling, playSound, showNotice,
        screenPaused, screenShareReady, setScreenStream, setScreenSharing, setScreenPaused, setScreenShareReady } = context;
    ${['stopScreenShare', 'togglePauseScreenShare', 'startScreenShare'].map(name => declarations.get(name)).join('\n')}
    return { startScreenShare, stopScreenShare, togglePauseScreenShare };
`));
const renderBanner = new Function('React', 'context', 'actions', compile(`
    const {screenShareReady, screenPaused} = context;
    const {togglePauseScreenShare, stopScreenShare} = actions;
    return (${banner});
`));

function deferredCapture() {
    let finishProduce!: () => void;
    const pending = new Promise<void>(resolve => { finishProduce = resolve; });
    const camera = { paused: false, closed: false };
    const screen = { paused: false, closed: true };
    let registered = false;
    const track = { readyState: 'live', stop: vi.fn(() => { track.readyState = 'ended'; }) };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
    const context: any = {
        useCallback: (callback: unknown) => callback,
        sharingRef: { current: false }, sessionRevision: { current: 1 }, sessionActive: { current: true },
        screenStreamRef: { current: null }, joinedRef: { current: true },
        roomSettingsRef: { current: { allowScreenShare: true } }, busyRef: { current: {} }, initializingRef: { current: false },
        screenPaused: false, screenShareReady: false, screenSharing: false,
        setScreenStream: vi.fn(),
        setScreenSharing: (value: boolean) => { context.screenSharing = value; },
        setScreenPaused: (value: boolean) => { context.screenPaused = value; },
        setScreenShareReady: (value: boolean) => { context.screenShareReady = value; },
        navigator: { mediaDevices: { getDisplayMedia: vi.fn().mockResolvedValue(stream) } },
        signaling: { request: vi.fn().mockResolvedValue({}) }, playSound: vi.fn(), showNotice: vi.fn(),
        media: {
            canSend: true,
            produce: vi.fn(async () => { await pending; registered = true; screen.closed = false; }),
            setPaused: vi.fn((_kind: string, paused: boolean, source: string) => { (source === 'screen' ? screen : camera).paused = paused; }),
            closeProducerBySource: vi.fn(async (source: string) => { if (source === 'screen' && registered) screen.closed = true; }),
        },
    };
    return { context, camera, screen, track, finishProduce, actions: () => bindActions(context), html: () => renderToStaticMarkup(renderBanner(React, context, bindActions(context))) };
}

describe('presenting controls during screen-share startup', () => {
    it('keeps Pause disabled and closes a late screen producer when stopped before produce finishes', async () => {
        const share = deferredCapture();
        const startup = share.actions().startScreenShare();
        await vi.waitFor(() => expect(share.context.media.produce).toHaveBeenCalledOnce());
        expect(share.html()).toContain('Starting screen sharing');
        expect(share.html()).toMatch(/class="btn-banner-action"[^>]*disabled=""/);
        expect(share.html()).not.toMatch(/class="btn-banner-stop"[^>]*disabled/);
        share.actions().togglePauseScreenShare();
        expect(share.context.media.setPaused).not.toHaveBeenCalled();
        expect(share.context.screenPaused).toBe(false);
        await share.actions().stopScreenShare();
        expect(share.context.screenSharing).toBe(false);
        await share.actions().startScreenShare(); // No fresh capture while the cancelled producer is pending.
        share.finishProduce();
        await startup;
        expect(share.screen.closed).toBe(true);
        expect(share.track.readyState).toBe('ended');
        expect(share.context.screenShareReady).toBe(false);
        expect(share.context.media.closeProducerBySource).toHaveBeenCalledTimes(2);
        expect(share.context.signaling.request).not.toHaveBeenCalledWith('muteStateChanged', expect.objectContaining({ presenting: true }));
        expect(share.camera).toEqual({ paused: false, closed: false });
        expect(share.context.navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledOnce();
    });

    it('enables Pause after produce finishes and resumes the same screen independently of the camera', async () => {
        const share = deferredCapture();
        const startup = share.actions().startScreenShare();
        await vi.waitFor(() => expect(share.context.media.produce).toHaveBeenCalledOnce());
        share.finishProduce();
        await startup;
        expect(share.context.screenShareReady).toBe(true);
        expect(share.html()).toContain('You are presenting to everyone');
        expect(share.html()).not.toContain('disabled=""');
        share.actions().togglePauseScreenShare();
        expect(share.context.screenPaused).toBe(true);
        expect(share.screen.paused).toBe(true);
        share.actions().togglePauseScreenShare();
        expect(share.context.screenPaused).toBe(false);
        expect(share.screen.paused).toBe(false);
        await share.actions().stopScreenShare();
        expect(share.screen.closed).toBe(true);
        expect(share.context.screenShareReady).toBe(false);
        expect(share.camera).toEqual({ paused: false, closed: false });
        expect(share.context.navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledOnce();
    });
});
