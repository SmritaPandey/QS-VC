import { describe, expect, it } from 'vitest';
import { boardPoint, EMPTY_COLLABORATION, newerCollaboration, pollCounts, sharedFileError } from './collaboration-state';

describe('shared meeting activities', () => {
    it('keeps a newer broadcast when an older request finishes afterwards', () => {
        const current = { ...EMPTY_COLLABORATION, revision: 5, notes: { text: 'Newer shared notes', version: 2 } };
        expect(newerCollaboration(current, { ...EMPTY_COLLABORATION, revision: 4 })).toBe(current);
        const incoming = { ...current, revision: 6 };
        expect(newerCollaboration(current, incoming)).toBe(incoming);
    });
    it('normalises and bounds captured pointer positions without dividing by zero', () => {
        const rect = { left: 100, top: 50, width: 200, height: 100 };
        expect(boardPoint(200, 100, rect)).toEqual({ x: .5, y: .5 });
        expect(boardPoint(-10, 1000, rect)).toEqual({ x: 0, y: 1 });
        expect(boardPoint(200, 100, { ...rect, width: 0 })).toBeNull();
        expect(boardPoint(NaN, 100, rect)).toBeNull();
    });
    it('counts one current choice per peer and ignores invalid option indexes', () => {
        expect(pollCounts({ id: 'p', question: 'Lunch?', options: ['Yes', 'No'], closed: false, votes: { first: 0, second: 1, third: 0, invalid: 9, negative: -1 } })).toEqual([2, 1]);
    });
    it('limits shared files before any upload or browser download', () => {
        expect(sharedFileError(32768, 'application/pdf')).toBe('');
        expect(sharedFileError(32769, 'application/pdf')).toContain('32 KB');
        expect(sharedFileError(0, 'text/plain')).not.toBe('');
        expect(sharedFileError(12, 'text/html')).toContain('PNG');
    });
});
