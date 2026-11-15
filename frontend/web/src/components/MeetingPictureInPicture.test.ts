import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MeetingPipControls, pictureInPicturePreview } from './MeetingPictureInPicture';
import type { GridPeer } from './VideoGrid';
const track = (id: string, readyState = 'live') => ({ id, readyState }) as MediaStreamTrack;
const stream = (video: MediaStreamTrack) => ({ getVideoTracks: () => [video] }) as MediaStream;
function peers(...people: GridPeer[]) { return new Map(people.map(person => [person.peerId, person])); }

describe('floating meeting preview selection', () => {
    const camera = track('camera');
    const screen = track('screen');
    const local = track('local');
    it('shows a live remote presentation before the active speaker camera', () => {
        const result = pictureInPicturePreview(peers(
            { peerId: 'speaker', displayName: 'Speaker', videoTrack: camera },
            { peerId: 'presenter', displayName: 'Presenter', screenVideoTrack: screen },
        ), 'speaker', stream(local), false, 'Me');
        expect(result).toEqual({ name: 'Presenter is presenting', track: screen });
    });
    it('returns to a live camera after a presentation track ends, without retaining its frozen image', () => {
        const result = pictureInPicturePreview(peers(
            { peerId: 'presenter', displayName: 'Presenter', screenVideoTrack: track('ended-screen', 'ended') },
            { peerId: 'speaker', displayName: 'Speaker', videoTrack: camera },
        ), 'speaker', null, true, 'Me');
        expect(result).toEqual({ name: 'Speaker', track: camera });
    });
    it('never previews a camera that its participant has turned off', () => {
        const result = pictureInPicturePreview(peers({ peerId: 'speaker', displayName: 'Speaker', videoTrack: camera, videoOff: true }), 'speaker', stream(local), false, 'Me');
        expect(result).toEqual({ name: 'Me (You)', track: local });
    });
    it('uses an avatar when no camera is available and does not request new media', () => {
        expect(pictureInPicturePreview(peers(), null, stream(local), true, 'Me')).toEqual({ name: 'Me (You)', track: undefined });
    });
});


describe('floating meeting camera privacy controls', () => {
    function controls(videoOff: boolean, cameraStartAllowed: boolean) {
        return renderToStaticMarkup(createElement(MeetingPipControls, {
            audioMuted: true, videoOff, cameraStartAllowed,
            onToggleAudio: () => {}, onToggleVideo: () => {}, onReturn: () => {},
        }));
    }
    it('disables camera start and explains how to recover while the meeting tab is hidden', () => {
        const html = controls(true, false);
        expect(html).toContain('disabled="" title="Return to meeting to start camera"');
        expect(html).toContain('aria-label="Return to meeting to start camera"');
        expect(html).toContain('class="meeting-pip-camera-hint">Return to meeting to start camera.</p>');
    });
    it('keeps camera off available even if the main tab is hidden', () => {
        const html = controls(false, false);
        expect(html).not.toContain('disabled=""');
        expect(html).toContain('aria-label="Turn camera off"');
        expect(html).not.toContain('meeting-pip-camera-hint');
    });
    it('enables camera start after returning to the meeting tab', () => {
        const html = controls(true, true);
        expect(html).not.toContain('disabled=""');
        expect(html).toContain('aria-label="Turn camera on"');
    });
});
