import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import InviteModal from './InviteModal';

describe('InviteModal', () => {
    it('does not render when open is false', () => {
        const markup = renderToStaticMarkup(createElement(InviteModal, {
            open: false,
            meetingCode: 'ABC-123-XYZ',
            meetingTitle: 'Team Sync',
            onClose: () => {},
        }));
        expect(markup).toBe('');
    });

    it('renders all three invitation methods when open is true', () => {
        const markup = renderToStaticMarkup(createElement(InviteModal, {
            open: true,
            meetingCode: 'ABC-123-XYZ',
            meetingTitle: 'Team Sync',
            inviteToken: 'test-token',
            onClose: () => {},
        }));

        expect(markup).toContain('Invite to Team Sync');
        expect(markup).toContain('Members');
        expect(markup).toContain('Guest Link');
        expect(markup).toContain('Copy Meeting Link');
        expect(markup).toContain('Search by name or email');
        expect(markup).toContain('aria-label="Search members by name or email"');
        expect(markup).toContain('id="invite-tab-members" aria-controls="invite-panel-members" tabindex="0"');
        expect(markup).toContain('id="invite-panel-members" aria-labelledby="invite-tab-members"');
    });
});
