import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import VideoGrid, { RemoteAudio, type GridPeer } from './VideoGrid';

vi.mock('react', async importOriginal => {
    const react = await importOriginal<typeof import('react')>();
    return { ...react, useLayoutEffect: react.useEffect };
});

describe('VideoGrid screen and camera tiles', () => {
    it('keeps the presenter camera visible as a separate tile beside the screen stage', () => {
        const peer: GridPeer = {
            peerId: 'peer-1', displayName: 'Riya', role: 'member',
            audioTrack: { kind: 'audio' } as MediaStreamTrack,
            videoTrack: { kind: 'video', id: 'camera', readyState: 'live' } as MediaStreamTrack,
            screenVideoTrack: { kind: 'video', id: 'screen', readyState: 'live' } as MediaStreamTrack,
            presenting: true, audioMuted: false, videoOff: false,
        };
        const markup = renderToStaticMarkup(createElement(VideoGrid, {
            localStream: null,
            myPeerId: 'self',
            peers: new Map([[peer.peerId, peer]]),
            displayName: 'Host',
            videoOff: true,
            speaking: new Set<string>(),
            activeSpeaker: null,
            spotlightId: null,
            pinnedId: null,
            onPin: vi.fn(),
        }));

        expect(markup).toContain('Riya · Screen');
        expect(markup).toContain('Riya · Camera');
        expect(markup).toContain('class="video-tile qs-tile qs-tile--stage');
    });
});


it('shows four simultaneous shares in an independent content area alongside camera feeds', () => {
    const peers = new Map<string, GridPeer>(Array.from({ length: 4 }, (_, index) => [`peer-${index}`, {
        peerId: `peer-${index}`, displayName: `Presenter ${index}`, videoTrack: { id: `camera-${index}`, readyState: 'live' } as MediaStreamTrack,
        screenVideoTrack: { id: `screen-${index}`, readyState: 'live' } as MediaStreamTrack,
    }]));
    const markup = renderToStaticMarkup(createElement(VideoGrid, {
        localStream: null, myPeerId: 'self', peers, displayName: 'Host', videoOff: true,
        speaking: new Set<string>(), activeSpeaker: null, spotlightId: null, pinnedId: null, onPin: vi.fn(),
    }));
    expect(markup).toContain('aria-label="Shared content"');
    expect(markup).toContain('class="qs-content-grid" data-count="4"');
    expect(markup).toContain('aria-label="Participant cameras"');
    for (let index = 0; index < 4; index++) {
        expect(markup).toContain(`Presenter ${index} · Screen`);
        expect(markup).toContain(`Presenter ${index} · Camera`);
    }
});

it('preserves each camera source as its own tile with supplied site and user identity', () => {
    const live = (id: string) => ({ id, readyState: 'live' }) as MediaStreamTrack;
    const markup = renderToStaticMarkup(createElement(VideoGrid, {
        localStream: null, localCameraTracks: { 'camera:2': live('local2'), 'camera:3': live('local3'), 'camera:4': live('local4') },
        myPeerId: 'self', siteLocation: 'Lucknow HQ', userId: 'local-123',
        peers: new Map([['remote', { peerId: 'remote', displayName: 'Remote', siteLocation: 'Delhi branch', userId: 'remote-456', videoTrack: live('primary'), cameraTracks: { 'camera:2': live('remote2') } }]]),
        displayName: 'Host', videoOff: true, speaking: new Set<string>(), activeSpeaker: null, spotlightId: null, pinnedId: null, onPin: vi.fn(), tilesPerPage: 16,
    }));
    expect(markup).toContain('Host (You) · Camera 2'); expect(markup).toContain('Host (You) · Camera 3'); expect(markup).toContain('Host (You) · Camera 4');
    expect(markup).toContain('Remote · Camera 2'); expect(markup).toContain('Site: Delhi branch'); expect(markup).toContain('User ID: remote-456');
    expect(markup).toContain('Site: Lucknow HQ');
});

it('removes an offstage share immediately when a presenter returns to the audience', () => {
    const peer: GridPeer = {
        peerId: 'former-presenter', displayName: 'Former presenter', role: 'member', onStage: false,
        screenVideoTrack: { readyState: 'live' } as MediaStreamTrack,
    };
    const markup = renderToStaticMarkup(createElement(VideoGrid, {
        localStream: null, myPeerId: 'self', myRole: 'host', displayName: 'Host', videoOff: true,
        peers: new Map([[peer.peerId, peer]]), webinar: true, speaking: new Set<string>(),
        activeSpeaker: null, spotlightId: null, pinnedId: null, onPin: vi.fn(),
    }));
    expect(markup).not.toContain('Shared content');
    expect(markup).not.toContain('Former presenter');
});

it('plays microphone and shared display sound independently', () => {
    const peer: GridPeer = { peerId: 'presenter', displayName: 'Presenter', audioTrack: {} as MediaStreamTrack, screenAudioTrack: {} as MediaStreamTrack };
    const markup = renderToStaticMarkup(createElement(RemoteAudio, { peers: new Map([[peer.peerId, peer]]) }));
    expect(markup.match(/<audio /g)).toHaveLength(2);
});
