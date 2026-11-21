import { expect, it } from 'vitest';
import { whiteboardSvg } from './whiteboard-export';

it('exports the saved drawing and readable sticky notes in a standalone image', () => {
    const svg = whiteboardSvg(
        [{ id: 's', authorId: 'a', width: 6, color: '#006d77', points: [{ x: 0.5, y: 1 }] }],
        [{ id: 'n', authorId: 'a', authorName: 'A & B', text: '<script>\nHello 🌏', color: 'blue', version: 1 }],
        text => text.length * 10,
    );
    expect(svg).toContain('points="500,650"');
    expect(svg).toContain('A &amp; B');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('Hello 🌏');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('y="662"');
});
