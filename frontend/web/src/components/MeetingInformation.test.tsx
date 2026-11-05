import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MeetingInformation from './MeetingInformation';

describe('MeetingInformation', () => {
    it('shows a scannable join QR, meeting code, and copy actions', () => {
        const html = renderToStaticMarkup(createElement(MeetingInformation, {
            open: true,
            meetingCode: 'QS-ABCD-EFGH-JKLM',
            joinUrl: 'https://meet.example/meeting/QS-ABCD-EFGH-JKLM/preview?invite=token',
            meetingTitle: 'Planning session',
            onClose: () => {},
        }));

        expect(html).toContain('Information');
        expect(html).toContain('Planning session');
        expect(html).toContain('QS-ABCD-EFGH-JKLM');
        expect(html).toContain('QR code to join meeting QS-ABCD-EFGH-JKLM');
        expect(html).toContain('<svg');
        expect(html).toContain('Copy code');
        expect(html).toContain('Copy invite link');
        expect(html).toContain('Share invite');
    });
});
