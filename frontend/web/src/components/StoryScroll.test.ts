import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import StoryScroll from './StoryScroll';
import MeetingScene from './MeetingScene';
import HomePage from '../pages/HomePage';
import { MemoryRouter } from 'react-router-dom';

describe('upright meeting features', () => {
    it('offers distinct language examples and describes current meeting controls', () => {
        const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(HomePage)));
        for (const language of ['हिन्दी', 'English', 'తెలుగు', '日本語', 'Español', '中文']) expect(html).toContain(language);
        expect(html).not.toContain('Original');
        expect(html).toContain('Request a demo');
        expect(html.match(/id="features"/g)).toHaveLength(1);
        expect(html).toContain('Which languages can I use?');
        expect(html).toContain('What QS-VC offers');
        expect(html).toContain('Choose what you share.');
        expect(html).not.toContain('Stay quantum-safe');
        expect(html).not.toContain('An upcoming QS-VC feature');
        expect(html).not.toContain('Discuss security');
        const heroCopy = html.split('class="home-message"')[1].split('<figure')[0];
        expect(heroCopy).not.toContain('QS-VC brings video meetings');
    });
    it('renders four distinct feature rows with copy first and existing destinations', () => {
        const html = renderToStaticMarkup(createElement(StoryScroll, { caption: { text: 'Bonjour à tous.', language: 'fr', label: 'French sample' } }));
        expect(html.match(/<article /g)).toHaveLength(4);
        expect(html.match(/<figure /g)).toHaveLength(4);
        expect(html).not.toContain('<figcaption');
        expect(html).toContain('aria-live="off"');
        expect(html).toContain('<dl class="feature-device-list">');
        expect(html).toContain('<dt>Microphone</dt>');
        for (const id of ['story-prepare', 'story-meet', 'story-discuss', 'languages', 'story-host']) expect(html).toContain(`id="${id}"`);
        expect(html).toContain('href="/schedule"');
        expect(html).toContain('lang="fr">Bonjour à tous.');
        expect(html).not.toContain('क्या सभी');
        expect(html).not.toContain('Original');
        expect(html).not.toContain('01 /');
        expect(html.indexOf('meeting-feature-copy')).toBeLessThan(html.indexOf('<figure'));
    });
    it('forces the hero scene upright without camera or duplicate caption text', () => {
        const html = renderToStaticMarkup(createElement(MeetingScene, { upright: true, caption: { text: 'こんにちは。', language: 'ja', label: 'Japanese sample', announce: true } }));
        expect(html).toContain('aria-live="polite"');
        expect(html).toContain('class="meeting-scene-participants"');
        expect(html.match(/class="meeting-scene-person/g)).toHaveLength(3);
        expect(html).toContain('meeting-scene-main');
        expect(html).not.toContain('meeting-scene-camera');
        expect(html).not.toContain('Illustrative meeting');
        expect(html).not.toContain('style=');
        expect(html).not.toContain('rotate');
        expect(html.match(/こんにちは。/g)).toHaveLength(1);
        expect(html).not.toContain('01 / 03');
    });
});
