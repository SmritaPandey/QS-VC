import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import ShareScreenModal from './ShareScreenModal';

describe('ShareScreenModal', () => {
    it('renders closed when open is false', () => {
        const html = renderToString(
            React.createElement(ShareScreenModal, {
                open: false,
                onClose: vi.fn(),
                onSelect: vi.fn(),
            })
        );
        expect(html).toBe('');
    });

    it('renders all three screen sharing options when open', () => {
        const html = renderToString(
            React.createElement(ShareScreenModal, {
                open: true,
                onClose: vi.fn(),
                onSelect: vi.fn(),
            })
        );
        expect(html).toContain('Choose what to share');
        expect(html).toContain('Chrome / Browser Tab');
        expect(html).toContain('Application Window');
        expect(html).toContain('Entire Screen');
        expect(html).toContain('Share');
    });
});
