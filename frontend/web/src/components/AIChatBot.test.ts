import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AIChatBot from './AIChatBot';

it('renders the closed assistant without requiring a browser or a portal host', () => {
    const html = renderToStaticMarkup(createElement(AIChatBot));
    expect(html).toContain('aria-label="Open meeting assistant"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('qsvc-assistant-symbol');
    expect(html).not.toContain('aria-controls=');
    expect(html).not.toContain('role="complementary"');
});
