import { describe, it, expect } from 'vitest';
import { computeLayout, gridShape } from './meeting-layout';

const people = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, isLocal: i === 0, role: i === 0 ? 'host' : 'member' }));

describe('meeting layout', () => {
    it('pages a large meeting and keeps the active speaker on page 1', () => {
        const layout = computeLayout({ people: people(30), pageSize: 9, page: 0, activeSpeaker: 'p25' });
        expect(layout.pages).toBe(4);
        expect(layout.tiles).toHaveLength(9);
        expect(layout.tiles).toContain('p25');
        expect(computeLayout({ people: people(30), pageSize: 9, page: 7 }).page).toBe(3);
    });
    it('focus priority: own pin, then spotlight, then the latest presenter', () => {
        const list = people(4).map(p => ({ ...p, presenting: p.id === 'p2' }));
        expect(computeLayout({ people: list, pageSize: 9, page: 0 })).toMatchObject({ focusId: 'p2', focusReason: 'presenting' });
        expect(computeLayout({ people: list, pageSize: 9, page: 0, spotlightId: 'p3' })).toMatchObject({ focusId: 'p3', focusReason: 'spotlight' });
        expect(computeLayout({ people: list, pageSize: 9, page: 0, spotlightId: 'p3', pinnedId: 'p1' })).toMatchObject({ focusId: 'p1', focusReason: 'pinned' });
        expect(computeLayout({ people: list, pageSize: 9, page: 0, pinnedId: 'gone' }).focusId).toBe('p2');
        expect(computeLayout({ people: list, pageSize: 9, page: 0, spotlightId: 'p3' }).tiles).not.toContain('p3');
    });
    it('webinars show only the stage and count the audience', () => {
        const list = [...people(5), { id: 'guest', onStage: true }];
        const layout = computeLayout({ people: list, webinar: true, pageSize: 9, page: 0 });
        expect(layout.tiles.sort()).toEqual(['guest', 'p0']);
        expect(layout.audienceCount).toBe(4);
        expect(computeLayout({ people: list, webinar: true, pageSize: 9, page: 0, spotlightId: 'p3' }).focusId).toBeNull();
    });
    it('chooses a grid that fits the screen', () => {
        expect(gridShape(1, 1200, 700)).toEqual({ cols: 1, rows: 1 });
        expect(gridShape(4, 1200, 700)).toEqual({ cols: 2, rows: 2 });
        expect(gridShape(9, 1600, 800).cols).toBeGreaterThanOrEqual(3);
        expect(gridShape(4, 390, 700).cols).toBeLessThanOrEqual(2);
    });
});
