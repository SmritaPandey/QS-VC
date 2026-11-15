import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CaptionOverlay, { captionExpiresAt, visibleCaptionEntries, type CaptionEntry } from './CaptionOverlay';
const caption = (id: string, peerId = 'asha', receivedAt = 1000): CaptionEntry => ({
    id, peerId, speakerName: peerId === 'asha' ? 'Asha' : 'Ravi', text: 'The meeting starts at ten.',
    isFinal: true, timestamp: -100000, receivedAt,
});
describe('speaker-aware live captions', () => {
    it('keeps only two recent utterances and expires them using local receipt time', () => {
        const entries = [caption('one'), caption('two', 'ravi', 2000), caption('three', 'asha', 3000)];
        expect(visibleCaptionEntries(entries, 4000).map(entry => entry.id)).toEqual(['two', 'three']);
        expect(visibleCaptionEntries(entries, 8500).map(entry => entry.id)).toEqual(['three']);
        expect(visibleCaptionEntries(entries, 9000)).toEqual([]);
        expect(captionExpiresAt(entries[0])).toBe(7000);
    });
    it('lets long final text stay readable longer but clears abandoned interim speech quickly', () => {
        const long = { ...caption('long'), text: 'A'.repeat(500) };
        expect(captionExpiresAt(long)).toBe(13000);
        expect(captionExpiresAt({ ...long, isFinal: false })).toBe(6000);
    });
    it('keeps stable speaker identity and separate labels when speakers change', () => {
        vi.spyOn(Date, 'now').mockReturnValue(4000);
        try {
            const html = renderToStaticMarkup(<CaptionOverlay enabled captions={[caption('one'), { ...caption('two', 'ravi'), label: 'Translated', language: 'hi' }]} />);
            expect(html).toContain('data-speaker="asha"');
            expect(html).toContain('data-speaker="ravi"');
            expect(html).toContain('Asha</span>');
            expect(html).toContain('Ravi</span>');
            expect(html).toContain('Translated');
            expect(html).toContain('lang="hi"');
            expect(html).toContain('aria-relevant="additions text"');
        } finally { vi.restoreAllMocks(); }
    });
    it('renders nothing for disabled or expired captions', () => {
        vi.spyOn(Date, 'now').mockReturnValue(20000);
        try {
            expect(renderToStaticMarkup(<CaptionOverlay enabled captions={[caption('one')]} />)).toBe('');
            expect(renderToStaticMarkup(<CaptionOverlay enabled={false} captions={[caption('one', 'asha', 20000)]} />)).toBe('');
        } finally { vi.restoreAllMocks(); }
    });
});
