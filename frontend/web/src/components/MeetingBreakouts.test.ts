import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import MeetingBreakouts from './MeetingBreakouts';

vi.mock('../lib/signaling', () => ({ signaling: { request: vi.fn(), on: vi.fn() } }));

function renderRooms(connected: boolean) {
    return renderToStaticMarkup(createElement(MeetingBreakouts, {
        connected, isHost: true, currentRoomId: null, transitioning: false,
        participants: [], onJoin: vi.fn(), onClose: vi.fn(),
    }));
}

describe('MeetingBreakouts', () => {
    it('shows reconnect guidance instead of an indefinite loading status while disconnected', () => {
        expect(renderRooms(false)).toContain('Reconnect to manage or join breakout rooms.');
        expect(renderRooms(false)).not.toContain('Loading breakout rooms');
        expect(renderRooms(true)).toContain('Loading breakout rooms');
    });
});
