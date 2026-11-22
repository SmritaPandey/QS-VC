import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import ShareScreenModal from './ShareScreenModal';

function renderPicker(open: boolean, canCapture: boolean, canShareActivity: boolean) {
    return renderToString(React.createElement(ShareScreenModal, {
        open, canCapture, canShareActivity, onClose: vi.fn(), onSelect: vi.fn(), onActivity: vi.fn(),
    }));
}

describe('ShareScreenModal', () => {
    it('renders nothing when closed', () => {
        expect(renderPicker(false, true, true)).toBe('');
    });

    it('offers each capture surface to a screen-only presenter', () => {
        const html = renderPicker(true, true, false);
        expect(html).toContain('Share with the meeting');
        for (const surface of ['browser', 'window', 'monitor']) {
            expect(html).toContain(`value="${surface}"`);
        }
        expect(html).not.toContain('Share an activity');
    });

    it('offers activities when screen capture is unavailable', () => {
        const html = renderPicker(true, false, true);
        expect(html).toContain('Share an activity');
        expect(html).toContain('Whiteboard');
        expect(html).not.toContain('Present your screen');
    });

    it('explains when both sharing options are unavailable', () => {
        expect(renderPicker(true, false, false)).toContain('Sharing is currently unavailable');
    });
});
