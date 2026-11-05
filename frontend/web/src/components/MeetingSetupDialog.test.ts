import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MeetingSetupDialog from './MeetingSetupDialog';

describe('MeetingSetupDialog', () => {
    it('offers an instant meeting alongside conferencing, team meeting, and town hall/webinar', () => {
        const html = renderToStaticMarkup(createElement(MeetingSetupDialog, {
            action: 'link', creating: false, onClose: () => {}, onCreate: () => {},
        }));
        expect(html).toContain('Instant meeting');
        expect(html).toContain('Conferencing');
        expect(html).toContain('Team meeting');
        expect(html).toContain('Town hall / webinar');
        expect(html.match(/type="radio"/g)).toHaveLength(4);
        expect(html).toContain('Attendees wait in the meeting’s waiting room');
        expect(html).toContain('Create invitation link');
        expect(html).not.toContain('Start meeting</button>');
    });

    it('uses the start action when the host chose Start now', () => {
        const html = renderToStaticMarkup(createElement(MeetingSetupDialog, {
            action: 'start', creating: false, onClose: () => {}, onCreate: () => {},
        }));
        expect(html).toContain('Start meeting</button>');
    });
});
