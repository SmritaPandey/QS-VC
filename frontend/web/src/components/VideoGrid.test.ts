import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import VideoGrid, { type GridPeer } from './VideoGrid';

vi.mock('react', async importOriginal => {
    const react = await importOriginal<typeof import('react')>();
    return { ...react, useLayoutEffect: react.useEffect };
});

describe('VideoGrid screen and camera tiles', () => {
    it('keeps the presenter camera visible as a separate tile beside the screen stage', () => {
        const peer: GridPeer = {
            peerId: 'peer-1', displayName: 'Riya', role: 'member',
            audioTrack: { kind: 'audio' } as MediaStreamTrack,
            videoTrack: { kind: 'video', id: 'camera' } as MediaStreamTrack,
            screenVideoTrack: { kind: 'video', id: 'screen' } as MediaStreamTrack,
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
