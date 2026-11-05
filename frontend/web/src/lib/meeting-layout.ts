/**
 * Which tiles to show, and where. Pure so it is easy to test.
 *
 * - Meetings: a paged gallery. The active speaker is pulled onto page 1 if they are on a later page,
 *   so large meetings always show who is talking (Google Meet behaviour).
 * - A focus tile (your own pin, the host's spotlight, or whoever is presenting) puts the meeting into
 *   a "stage" layout: one large tile and a paged strip of the others.
 * - Webinars: only the stage (organiser, hosts, co-hosts and people invited on stage) is shown;
 *   everyone else is the audience and appears only as a count.
 */
export interface LayoutPerson {
    id: string;
    isLocal?: boolean;
    role?: string;
    onStage?: boolean;
    presenting?: boolean;
    handRaised?: boolean;
}

export interface LayoutInput {
    people: LayoutPerson[];          // join order, local first
    webinar?: boolean;
    pinnedId?: string | null;        // this viewer's own pin
    spotlightId?: string | null;     // host's spotlight for everyone
    activeSpeaker?: string | null;
    pageSize: number;
    page: number;
}

export interface LayoutResult {
    focusId: string | null;
    focusReason: 'pinned' | 'spotlight' | 'presenting' | null;
    tiles: string[];                 // tiles on the current page (excluding focus)
    page: number;                    // clamped page
    pages: number;
    audienceCount: number;
}

export const isOnStage = (p: { role?: string; onStage?: boolean }) => p.role === 'host' || p.role === 'co-host' || !!p.onStage;

export function computeLayout({ people, webinar = false, pinnedId, spotlightId, activeSpeaker, pageSize, page }: LayoutInput): LayoutResult {
    const visible = webinar ? people.filter(isOnStage) : people;
    const audienceCount = people.length - visible.length;
    const has = (id?: string | null) => !!id && visible.some(p => p.id === id);
    const presenter = [...visible].reverse().find(p => p.presenting)?.id;
    const focusId = presenter ?? (has(spotlightId) ? spotlightId! : has(pinnedId) ? pinnedId! : null);
    const focusReason: LayoutResult['focusReason'] = presenter ? 'presenting' : !focusId ? null : focusId === spotlightId ? 'spotlight' : 'pinned';

    let order = visible.filter(p => p.id !== focusId).map(p => p.id);
    const size = Math.max(1, pageSize);
    // Keep the active speaker on the first page.
    if (activeSpeaker && order.indexOf(activeSpeaker) >= size) {
        order = order.filter(id => id !== activeSpeaker);
        order.splice(size - 1, 0, activeSpeaker);
    }
    const pages = Math.max(1, Math.ceil(order.length / size));
    const current = Math.min(Math.max(0, page), pages - 1);
    return { focusId, focusReason, tiles: order.slice(current * size, current * size + size), page: current, pages, audienceCount };
}

/** Tiles per page when the viewer chose "Auto". */
export function autoPageSize(width: number, height: number, withFocus: boolean): number {
    if (withFocus) return width < 700 ? 3 : width < 1200 ? 4 : 6;
    if (width < 600) return height > 700 ? 6 : 4;
    if (width < 1100) return 9;
    return height < 800 ? 12 : 16;
}

export function gridShape(count: number, width: number, height: number): { cols: number; rows: number } {
    if (count <= 1) return { cols: 1, rows: 1 };
    const portrait = height > width * 1.1;
    let best = { cols: count, rows: 1, score: -1 };
    for (let cols = 1; cols <= count; cols++) {
        const rows = Math.ceil(count / cols);
        const tileW = width / cols, tileH = height / rows;
        const ratio = portrait ? 3 / 4 : 16 / 9;
        const fitted = Math.min(tileW, tileH * ratio);
        if (fitted > best.score) best = { cols, rows, score: fitted };
    }
    return { cols: best.cols, rows: best.rows };
}
