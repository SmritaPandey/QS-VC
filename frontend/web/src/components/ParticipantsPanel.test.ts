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


describe('ParticipantsPanel host transfer eligibility', () => {
    const peers = new Map([
        ['member', { peerId: 'member', displayName: 'Alice', role: 'member', userId: 'user-a' }],
        ['cohost', { peerId: 'cohost', displayName: 'Blair', role: 'co-host', userId: 'user-b' }],
        ['guest', { peerId: 'guest', displayName: 'Casey', role: 'guest', userId: 'user-c' }],
        ['unsigned', { peerId: 'unsigned', displayName: 'Drew', role: 'member', userId: null }],
        ['guest-flag', { peerId: 'guest-flag', displayName: 'Ellis', role: 'member', userId: 'user-e', isGuest: true }],
        ['host', { peerId: 'host', displayName: 'Other host', role: 'host', userId: 'user-h' }],
        ['self', { peerId: 'self', displayName: 'Duplicate self', role: 'member', userId: 'user-self' }],
    ]);

    const render = (myRole = 'host', canManage = true, onTransferHost: (() => Promise<void>) | undefined = async () => {}) => renderToStaticMarkup(createElement(ParticipantsPanel, {
        peers, displayName: 'Me', myPeerId: 'self', myRole, canManage, onTransferHost, onClose: () => {},
    }));

    it('offers host transfer only for signed-in remote members and co-hosts', () => {
        const markup = render();
        expect(markup.match(/class="participant-action participant-transfer-action"/g)).toHaveLength(2);
        expect(markup).toContain('aria-label="Make Alice host"');
        expect(markup).toContain('aria-label="Make Blair host"');
        for (const name of ['Casey', 'Drew', 'Ellis', 'Other host', 'Duplicate self', 'Me (You)']) {
            expect(markup).not.toContain(`aria-label="Make ${name} host"`);
        }
    });

    it.each(['co-host', 'member', 'guest'])('hides transfer from a %s', role => {
        expect(render(role)).not.toContain('participant-transfer-action');
    });

    it('hides transfer when moderation is unavailable', () => {
        expect(render('host', false)).not.toContain('participant-transfer-action');
    });

    it('hides transfer when no callback is provided', () => {
        const markup = renderToStaticMarkup(createElement(ParticipantsPanel, {
            peers, displayName: 'Me', myRole: 'host', canManage: true, onClose: () => {},
        }));
        expect(markup).not.toContain('participant-transfer-action');
    });
});
