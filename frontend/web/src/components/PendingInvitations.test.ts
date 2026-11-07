import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import PendingInvitations from './PendingInvitations';

vi.mock('react-router-dom', () => ({
    useNavigate: () => vi.fn(),
}));

describe('PendingInvitations', () => {
    it('renders loading state initially during server rendering', () => {
        const markup = renderToStaticMarkup(createElement(PendingInvitations, {}));
        expect(markup).toContain('Loading invitations…');
        expect(markup).toContain('Checking for meetings you’ve been invited to.');
    });
});

