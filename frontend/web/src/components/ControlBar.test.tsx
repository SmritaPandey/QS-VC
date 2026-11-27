import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ControlBar, { RestrictedFeatureButton } from './ControlBar';

// Render the menu-open state without pretending this exercises a browser interaction.
vi.mock('react', async importOriginal => {
    const actual = await importOriginal<typeof import('react')>();
    return { ...actual, useState: (initial: unknown) => [initial === false ? true : initial, vi.fn()] };
});
const noop = () => {};
function controls(overrides: Record<string, unknown> = {}) {
    return renderToStaticMarkup(<ControlBar audioMuted videoOff screenSharing={false} isRecording={false}
        chatOpen={false} participantsOpen={false} handRaised={false} viewMode="auto"
        onToggleAudio={noop} onToggleVideo={noop} onToggleScreen={noop} onToggleRecording={noop}
        onToggleChat={noop} onToggleParticipants={noop} onRaiseHand={noop} onChangeView={noop} onLeave={noop}
        onSignInForExtras={noop} onOpenEffects={noop} onToggleCaptions={noop} {...overrides} />);
}

describe('meeting feature discoverability', () => {
    it('shows named locked features to guests instead of a generic sign-in row', () => {
        const html = controls();
        expect(html).not.toContain('Sign in for extra features');
        expect(html).toContain('Backgrounds and effects. Sign in · Basic.');
        expect(html).toContain('AI noise reduction. Sign in · Basic.');
        expect(html).toContain('Captions and language settings. Sign in to choose your language.');
        expect(html).toContain('Record meeting. Sign in as host · Basic.');
        expect(html).toContain('Host controls. Host or co-host only.');
        expect(html).not.toContain('Meeting assistant');
    });
    it('shows the host requirement independently of plan access for signed-in participants', () => {
        expect(controls({ signedIn: true, canRecord: false, recordingLocked: false })).toContain('Record meeting. Host only · Basic.');
    });
    it('uses the verified minimum plan mapping for locked features', () => {
        const html = controls({ signedIn: true, canRecord: true, effectsLocked: true, recordingLocked: true,
            featureMinimumPlans: { background_effects: 'business', cloud_recording: 'enterprise' } });
        expect(html).toContain('Backgrounds and effects. Business plan.');
        expect(html).toContain('Record meeting. Enterprise plan.');
    });
    it('does not lock stop-recording when plan or role state changes', () => {
        const html = controls({ signedIn: false, canRecord: false, recordingLocked: true, isRecording: true });
        expect(html).toContain('Stop recording');
        expect(html).not.toContain('Stop recording. Sign in');
    });
    it('offers one stop action while recording', () => {
        const html = controls({ signedIn: true, canRecord: true, isRecording: true, onRecordLocally: noop });
        expect(html.match(/>Stop recording</g)).toHaveLength(1);
        expect(html).not.toContain('Record on this device');
    });
    it('keeps existing signed-in language access and assistant placement unchanged', () => {
        const html = controls({ signedIn: true, captionsLocked: true, onToggleLanguage: noop });
        expect(html).not.toContain('Meeting assistant. Sign in.');
        expect(html).not.toContain('Captions and language settings. Starter plan.');
        expect(html).toContain('Captions and language settings');
    });
    it('names the compact leave control and exposes the captions plan in compact More', () => {
        const html = controls({ signedIn: true, captionsLocked: true });
        expect(html).toContain('aria-label="Leave meeting"');
        expect(html).toContain('Turn on captions. Starter plan.');
    });
    it('places common actions in their corresponding More groups', () => {
        const html = controls({ onOpenQuality: noop, onOpenMultiCamera: noop, onReportProblem: noop, onToggleFullscreen: noop });
        const sections = html.split(/<h3>([^<]+)<\/h3>/);
        const group = (heading: string) => sections[sections.indexOf(heading) + 1];
        expect(group('Meeting tools')).toContain('Host controls');
        expect(group('Recording')).toContain('Record meeting');
        expect(group('Audio and video')).toContain('Connection quality');
        expect(group('Audio and video')).toContain('Additional cameras');
        expect(group('Layout')).toContain('Full screen');
        expect(group('Help')).toContain('Report a problem');
    });
    it('routes locked feature activation to access resolution without invoking the feature', () => {
        const activate = vi.fn(); const resolve = vi.fn();
        const button = RestrictedFeatureButton({ label: 'Backgrounds and effects', icon: 'background_replace', requirement: 'Sign in · Basic', onActivate: activate, onResolve: resolve });
        button.props.onClick();
        expect(resolve).toHaveBeenCalledOnce();
        expect(activate).not.toHaveBeenCalled();
    });
    it('runs the feature only when no requirement remains', () => {
        const activate = vi.fn(); const resolve = vi.fn();
        RestrictedFeatureButton({ label: 'Backgrounds and effects', icon: 'background_replace', onActivate: activate, onResolve: resolve }).props.onClick();
        expect(activate).toHaveBeenCalledOnce();
        expect(resolve).not.toHaveBeenCalled();
    });
});
