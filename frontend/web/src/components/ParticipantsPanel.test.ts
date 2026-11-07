import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ParticipantsPanel from './ParticipantsPanel';

describe('ParticipantsPanel private conversation actions', () => {
    it('lets a host or co-host start a private conversation with any other participant', () => {
        const markup = renderToStaticMarkup(createElement(ParticipantsPanel, {
            peers: new Map([
                ['host-peer', { peerId: 'host-peer', displayName: 'Host', role: 'host' }],
                ['cohost-peer', { peerId: 'cohost-peer', displayName: 'Co-host', role: 'co-host' }],
                ['guest-peer', { peerId: 'guest-peer', displayName: 'Guest', role: 'guest' }],
            ]),
            displayName: 'Me',
            myPeerId: 'self',
            myRole: 'co-host',
            canStartPrivateConversation: true,
            privateConversationLimitLabel: '30 min',
            onStartPrivateConversation: () => {},
            onClose: () => {},
        }));

        expect(markup.match(/Talk privately · 30 min/g)).toHaveLength(3);
        expect(markup).toContain('Host</span>');
        expect(markup).toContain('Co-host</span>');
        expect(markup).toContain('Guest</span>');
    });

    it('displays Member tags and provides host controls when canManage is true', () => {
        const markup = renderToStaticMarkup(createElement(ParticipantsPanel, {
            peers: new Map([
                ['member-peer', { peerId: 'member-peer', displayName: 'Alice Member', role: 'member', audioMuted: false }],
                ['guest-peer', { peerId: 'guest-peer', displayName: 'Bob Guest', role: 'guest', audioMuted: false }],
            ]),
            displayName: 'Host User',
            myPeerId: 'host-self',
            myRole: 'host',
            canManage: true,
            onClose: () => {},
        }));

        expect(markup).toContain('Member</span>');
        expect(markup).toContain('Guest</span>');
        expect(markup).toContain('Mute participant');
        expect(markup).toContain('Make co-host');
        expect(markup).toContain('Remove from meeting');
    });
});
