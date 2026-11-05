import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PrivateConversationPanel from './PrivateConversationPanel';

const noOp = () => {};

describe('PrivateConversationPanel', () => {
    it('explains a private invitation and offers accept or decline without leaving the meeting', () => {
        const markup = renderToStaticMarkup(createElement(PrivateConversationPanel, {
            invite: { conversationId: 'call-1', otherDisplayName: 'Alex', direction: 'incoming', durationMs: 120_000 },
            active: null,
            microphoneMuted: true,
            focusAudio: false,
            onAccept: noOp, onDecline: noOp, onCancel: noOp, onEnd: noOp,
            onToggleMicrophone: noOp, onToggleFocusAudio: noOp,
        }));
        expect(markup).toContain('Alex wants to speak with you.');
        expect(markup).toContain('Only you and Alex will hear the side conversation');
        expect(markup).toContain('Accept</button>');
        expect(markup).toContain('Decline</button>');
        expect(markup).toContain('2 min');
    });

    it('keeps main audio focus and private mic controls visible during an unlimited conversation', () => {
        const markup = renderToStaticMarkup(createElement(PrivateConversationPanel, {
            invite: null,
            active: { conversationId: 'call-2', otherDisplayName: 'Sam', endsAt: null, durationMs: null, otherMicrophoneMuted: true },
            microphoneMuted: true,
            focusAudio: false,
            onAccept: noOp, onDecline: noOp, onCancel: noOp, onEnd: noOp,
            onToggleMicrophone: noOp, onToggleFocusAudio: noOp,
        }));
        expect(markup).toContain('Talking privately with Sam');
        expect(markup).toContain('Only the two of you can hear this call');
        expect(markup).toContain('Unmute private mic');
        expect(markup).toContain('Focus on them');
        expect(markup).toContain('Sam has their private mic muted.');
        expect(markup).toContain('Unlimited');
        expect(markup).toContain('End conversation</button>');
    });
});
