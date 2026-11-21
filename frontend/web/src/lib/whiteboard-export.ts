import type { BoardStickyNote, BoardStroke, StickyColor } from './collaboration-state';

const noteColors: Record<StickyColor, string> = {
    yellow: '#ffefad', orange: '#ffd2aa', blue: '#cbe7ff', purple: '#e4d7ff', pink: '#ffd7e3',
};

// The file can be opened independently of the meeting. Only text, paths and solid fills go into it.
function escapeText(value: string) {
    return value.replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function wrapText(text: string, measure: (text: string) => number): string[] {
    return text.replace(/\r\n?/g, '\n').split('\n').flatMap(paragraph => {
        const lines: string[] = [];
        let line = '';
        for (const character of paragraph) {
            if (line && measure(line + character) > 900) {
                const space = line.lastIndexOf(' ');
                if (space > 0) {
                    lines.push(line.slice(0, space));
                    line = line.slice(space + 1);
                } else {
                    lines.push(line);
                    line = '';
                }
            }
            line += character;
        }
        return [...lines, line];
    });
}

export function whiteboardSvg(strokes: BoardStroke[], notes: BoardStickyNote[], measure: (text: string) => number) {
    const elements = strokes.map(stroke => {
        const color = /^#[\da-f]{6}$/i.test(stroke.color) ? stroke.color : '#102a43';
        const points = stroke.points.map(({ x, y }) => `${x * 1000},${y * 650}`).join(' ');
        return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="${Number(stroke.width)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    });
    let y = strokes.length ? 650 : 0;
    for (const note of notes) {
        const lines = wrapText(note.text, measure);
        const author = wrapText(note.authorName, measure);
        const height = 28 + 24 * (author.length + lines.length);
        y += 12;
        elements.push(`<rect x="24" y="${y}" width="952" height="${height}" rx="8" fill="${noteColors[note.color]}"/>`);
        for (const [index, line] of [...author, ...lines].entries()) {
            const weight = index < author.length ? 600 : 400;
            elements.push(`<text x="40" y="${y + 28 + 24 * index}" font-weight="${weight}">${escapeText(line)}</text>`);
        }
        y += height;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${y + 12}" font-family="sans-serif" font-size="18" fill="#102a43"><title>Meeting whiteboard</title><rect width="100%" height="100%" fill="white"/>${elements.join('')}</svg>`;
}

export function downloadWhiteboard(strokes: BoardStroke[], notes: BoardStickyNote[]) {
    const context = document.createElement('canvas').getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.font = '600 18px sans-serif';
    const svg = whiteboardSvg(strokes, notes, text => context.measureText(text).width);
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'QS-VC-whiteboard.svg';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
