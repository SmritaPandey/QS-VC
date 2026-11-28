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
    const { useCallback, audioOnlyRef, sharingRef, sessionRevision, sessionActive, screenStreamRef, joinedRef, canPublishRef,
        roomSettingsRef, myRoleRef, busyRef, initializingRef, media, navigator, signaling, playSound, showNotice,
        screenPaused, screenShareReady, setScreenStream, setScreenSharing, setScreenPaused, setScreenShareReady } = context;
    ${['stopScreenShare', 'togglePauseScreenShare', 'startScreenShare'].map(name => declarations.get(name)).join('\n')}
    return { startScreenShare, stopScreenShare, togglePauseScreenShare };
`));
const renderBanner = new Function('React', 'context', 'actions', compile(`
    const {screenShareReady, screenPaused, secureActivities, encryptedNotes, setShareScreenModalOpen} = context;
    const manager = ['host', 'co-host'].includes(context.myRoleRef.current);
    const {togglePauseScreenShare, stopScreenShare} = actions;
    return (${banner});
`));

function deferredCapture() {
    let finishProduce!: () => void;
    const pending = new Promise<void>(resolve => { finishProduce = resolve; });
    const camera = { paused: false, closed: false };
    const screen = { paused: false, closed: true };
    let registered = false;
    const track = { readyState: 'live', onended: null as (() => void) | null, stop: vi.fn(() => { track.readyState = 'ended'; }) };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [] };
    const context: any = {
        useCallback: (callback: unknown) => callback,
        audioOnlyRef: { current: false }, sharingRef: { current: false }, sessionRevision: { current: 1 }, sessionActive: { current: true },
        screenStreamRef: { current: null }, joinedRef: { current: true }, canPublishRef: { current: true },
        myRoleRef: { current: 'member' }, roomSettingsRef: { current: { allowScreenShare: true } }, busyRef: { current: {} }, initializingRef: { current: false },
        screenPaused: false, screenShareReady: false, screenSharing: false,
        secureActivities: false, encryptedNotes: undefined, setShareScreenModalOpen: vi.fn(),
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
    it('starts a guest share after a live grant even if optional display audio fails', async () => {
        const share = deferredCapture();
        share.context.myRoleRef.current = 'guest';
        share.context.roomSettingsRef.current.allowScreenShare = false;
        await share.actions().startScreenShare();
        expect(share.context.navigator.mediaDevices.getDisplayMedia).not.toHaveBeenCalled();
        share.context.roomSettingsRef.current.allowScreenShare = true;
        const sound = { readyState: 'live', stop: vi.fn() };
        share.context.navigator.mediaDevices.getDisplayMedia.mockResolvedValue({
            getTracks: () => [share.track, sound], getVideoTracks: () => [share.track], getAudioTracks: () => [sound],
        });
        share.context.media.produce.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Audio relay failed'));
        await share.actions().startScreenShare('browser', true);
        expect(share.context.screenShareReady).toBe(true);
        expect(sound.stop).toHaveBeenCalledOnce();
        expect(share.track.stop).not.toHaveBeenCalled();
    });
    it('ignores an ended event from a previous share and ends the active share when its source closes', async () => {
        const share = deferredCapture();
        share.finishProduce();
        const actions = share.actions();
        await actions.startScreenShare();
        const previousEnded = share.track.onended!;
        await actions.stopScreenShare();
        const next = { ...share.track, readyState: 'live', onended: null as (() => void) | null, stop: vi.fn() };
        share.context.navigator.mediaDevices.getDisplayMedia.mockResolvedValue({
            getTracks: () => [next], getVideoTracks: () => [next], getAudioTracks: () => [],
        });
        await actions.startScreenShare();
        previousEnded();
        expect(share.context.screenSharing).toBe(true);
        expect(next.stop).not.toHaveBeenCalled();
        next.onended!();
        expect(share.context.screenSharing).toBe(false);
        expect(next.stop).toHaveBeenCalledOnce();
    });
    it('blocks attendee capture before permission and lets the host present', async () => {
        const share = deferredCapture();
        share.context.roomSettingsRef.current.allowScreenShare = false;
        await share.actions().startScreenShare();
        expect(share.context.navigator.mediaDevices.getDisplayMedia).not.toHaveBeenCalled();
        share.context.myRoleRef.current = 'host';
        const startup = share.actions().startScreenShare();
        share.finishProduce();
        await startup;
        expect(share.context.screenShareReady).toBe(true);
    });

    it('publishes selected display sound alongside video', async () => {
        const share = deferredCapture();
        const sound = { readyState: 'live', stop: vi.fn() };
        share.context.navigator.mediaDevices.getDisplayMedia.mockResolvedValue({
            getVideoTracks: () => [share.track], getAudioTracks: () => [sound], getTracks: () => [share.track, sound],
        });
        share.finishProduce();
        await share.actions().startScreenShare('browser', true);
        expect(share.context.navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: true }));
        expect(share.context.media.produce.mock.calls.map(([track]: [unknown]) => track)).toEqual([share.track, sound]);
        expect(share.context.screenShareReady).toBe(true);
        await share.actions().stopScreenShare();
        expect(sound.stop).toHaveBeenCalledOnce();
    });

    it('announces stop immediately even while closing the SFU producer is delayed', async () => {
        const share = deferredCapture();
        share.context.sharingRef.current = true;
        share.context.screenStreamRef.current = { getTracks: () => [share.track] };
        let finishClose!: () => void;
        share.context.media.closeProducerBySource = vi.fn(() => new Promise<void>(resolve => { finishClose = resolve; }));
        const stopping = share.actions().stopScreenShare();
        expect(share.context.signaling.request).toHaveBeenCalledWith('muteStateChanged', { kind: 'screen', muted: false, presenting: false });
        expect(share.context.screenSharing).toBe(false);
        expect(share.track.readyState).toBe('ended');
        finishClose();
        await stopping;
    });

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
