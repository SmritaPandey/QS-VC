import { useEffect, useRef, useState, type ReactNode } from 'react';
import { haptic } from '../lib/haptics';
import type { TilesPerPage, ViewMode } from './VideoGrid';
import '../styles/meeting-feature-access.css';

interface Props {
    assistant?: ReactNode;
    activitiesOpen?: boolean;
    hostToolsOpen?: boolean;
    onToggleActivities?: () => void;
    onToggleHostTools?: () => void;
    audioMuted: boolean;
    videoOff: boolean;
    screenSharing: boolean;
    isRecording: boolean;
    canRecord?: boolean;
    recordingLocked?: boolean;
    signedIn?: boolean;
    captionsLocked?: boolean;
    effectsLocked?: boolean;
    noiseMode?: 'off' | 'standard' | 'ai';
    aiNoiseSuppressionLocked?: boolean;
    onChangeNoiseMode?: (mode: 'off' | 'standard' | 'ai') => void;
    onRequirePlanFeature?: (feature: string) => void;
    onSignInForExtras?: () => void;
    onExplainAccess?: (message: string) => void;
    featureMinimumPlans?: Readonly<Record<string, string>>;
    chatOpen: boolean;
    participantsOpen: boolean;
    handRaised: boolean;
    reactionsOpen?: boolean;
    languageOpen?: boolean;
    /** short name of the speaking language, e.g. "Hindi" */
    languageLabel?: string;
    /** short code shown on the language button, e.g. "HI" */
    languageCode?: string;
    onToggleAudio: () => void;
    onToggleVideo: () => void;
    onToggleScreen: () => void;
    onOpenInvite?: () => void;
    onToggleRecording: () => void;
    onToggleChat: () => void;
    onToggleParticipants: () => void;
    onRaiseHand: () => void;
    onToggleReactions?: () => void;
    onToggleLanguage?: () => void;
    /** CC: show meeting captions (and share mine, once agreed) */
    captionsOn?: boolean;
    onToggleCaptions?: () => void;
    pictureInPicture?: boolean;
    onTogglePictureInPicture?: () => void;
    fullscreen?: boolean;
    onToggleFullscreen?: () => void;
    effectsOn?: boolean;
    onOpenEffects?: () => void;
    onReportProblem?: () => void;
    tilesPerPage?: TilesPerPage;
    onChangeTilesPerPage?: (value: TilesPerPage) => void;
    audioOutputId?: string;
    audioOutputDevices?: Array<{ deviceId: string; label: string }>;
    audioOutputSupported?: boolean;
    onAudioOutputChange?: (deviceId: string) => void;
    onChooseAudioOutput?: () => void;
    activitySignal?: number;
    keepSideVisible?: boolean;
    viewMode: ViewMode;
    onChangeView: (view: ViewMode) => void;
    onLeave: () => void;
}

interface ToggleProps {
    /** true = the feature is on (mic live, camera on, panel open…) */
    on: boolean;
    label: string;
    title: string;
    iconOn: string;
    iconOff: string;
    /** extra state class when on/off, e.g. 'active-muted' for a muted mic */
    stateClass?: string;
    locked?: boolean;
    /** 'danger' paints the off state red (mic / camera muted) */
    offTone?: 'neutral' | 'danger';
    onToggle: () => void;
    controls?: string;
    /** tiny text badge on the icon, e.g. language code "HI" */
    badge?: string;
}

const FLASH_MS = 900;
const VIEWS = [['auto', 'auto_awesome_mosaic', 'Auto'], ['tiled', 'grid_view', 'Tiled'], ['spotlight', 'crop_landscape', 'Spotlight'], ['sidebar', 'view_sidebar', 'Sidebar']] as const;
const TILE_OPTIONS: TilesPerPage[] = ['auto', 4, 9, 16, 25, 49];

function ToggleControl({ on, label, title, iconOn, iconOff, stateClass = '', locked = false, offTone = 'neutral', onToggle, controls, badge }: ToggleProps) {
    // On click, a small switch briefly replaces the icon, slides to the new state, then fades away.
    const [flash, setFlash] = useState<{ id: number; to: boolean } | null>(null);
    const timer = useRef<number>();
    useEffect(() => () => window.clearTimeout(timer.current), []);
    const press = () => {
        const to = !on;
        haptic(to ? 'toggleOn' : 'toggleOff');
        setFlash({ id: Date.now(), to });
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setFlash(null), FLASH_MS); // also covers reduced motion (no animationend)
        onToggle();
    };
    return (
        <button
            type="button"
            className={`ctrl-btn ctrl-toggle ${stateClass} ${locked ? 'is-locked' : ''} ${on ? 'is-on' : 'is-off'} ${offTone === 'danger' ? 'tone-danger' : ''} ${flash ? 'is-flashing' : ''}`}
            aria-label={title}
            aria-disabled={locked || undefined}
            aria-pressed={on}
            aria-expanded={controls ? on : undefined}
            aria-controls={controls}
            data-tip={title}
            onClick={press}
        >
            <span className="ctrl-icon mi" aria-hidden="true" key={on ? 'on' : 'off'}>{on ? iconOn : iconOff}</span>
            {badge && <span className="ctrl-badge" aria-hidden="true">{badge}</span>}
            <span className="ctrl-label">{label}</span>
            {locked && <span className="mi ctrl-plan-lock" aria-hidden="true">lock</span>}
            {flash && (
                <span key={flash.id} className={`ctrl-switch-flash ${flash.to ? 'to-on' : 'to-off'}`} aria-hidden="true"
                    onAnimationEnd={(e) => { if (e.target === e.currentTarget) setFlash(null); }}>
                    <i />
                </span>
            )}
        </button>
    );
}

export function RestrictedFeatureButton({ label, icon, active, requirement, onActivate, onResolve }: {
    label: string; icon: string; active?: boolean; requirement?: string;
    onActivate?: () => void; onResolve?: () => void;
}) {
    return <button type="button" title={requirement} aria-label={requirement ? `${label}. ${requirement}.` : undefined}
        aria-pressed={active} aria-disabled={Boolean(requirement) || undefined} className={requirement ? 'is-feature-locked' : undefined}
        onClick={() => requirement ? onResolve?.() : onActivate?.()}>
        <span className="mi" aria-hidden="true">{icon}</span>
        <span className="meeting-feature-label">{label}{requirement && <span className="meeting-feature-requirement">{requirement}</span>}</span>
        {requirement && <span className="mi ctrl-plan-lock" aria-hidden="true">lock</span>}
    </button>;
}

export default function ControlBar({
    assistant, isRecording, canRecord = false, recordingLocked = false, onToggleRecording,
    signedIn = false, captionsLocked = false, effectsLocked = false, noiseMode = 'standard', aiNoiseSuppressionLocked = false,
    onChangeNoiseMode, onRequirePlanFeature, onSignInForExtras, onExplainAccess, featureMinimumPlans = {},
    activitiesOpen = false, hostToolsOpen = false, onToggleActivities, onToggleHostTools,
    audioMuted, videoOff, screenSharing,
    chatOpen, participantsOpen, handRaised, reactionsOpen = false, languageOpen = false, languageLabel, languageCode,
    onToggleAudio, onToggleVideo, onToggleScreen, onOpenInvite,
    onToggleChat, onToggleParticipants, onRaiseHand, onToggleReactions, onToggleLanguage,
    captionsOn = false, onToggleCaptions, pictureInPicture = false, onTogglePictureInPicture, fullscreen = false, onToggleFullscreen, effectsOn = false, onOpenEffects, onReportProblem,
    tilesPerPage = 'auto', onChangeTilesPerPage,
    audioOutputId = '', audioOutputDevices = [], audioOutputSupported = false, onAudioOutputChange, onChooseAudioOutput,
    onLeave, viewMode, onChangeView, activitySignal = 0, keepSideVisible = false,
}: Props) {
    function minimumPlan(feature: string, fallback: string) {
        const value = featureMinimumPlans[feature] || fallback;
        return value.charAt(0).toUpperCase() + value.slice(1);
    }
    const effectsRequirement = !signedIn ? `Sign in · ${minimumPlan('background_effects', 'basic')}` : effectsLocked ? `${minimumPlan('background_effects', 'basic')} plan` : undefined;
    const noiseRequirement = !signedIn ? `Sign in · ${minimumPlan('ai_noise_suppression', 'basic')}` : aiNoiseSuppressionLocked ? `${minimumPlan('ai_noise_suppression', 'basic')} plan` : undefined;
    const languageRequirement = !signedIn ? 'Sign in to choose your language' : undefined;
    const recordingRequirement = isRecording ? undefined : !signedIn ? `Sign in as host · ${minimumPlan('cloud_recording', 'pro')}` : !canRecord ? `Host only · ${minimumPlan('cloud_recording', 'pro')}` : recordingLocked ? `${minimumPlan('cloud_recording', 'pro')} plan` : undefined;
    const resolvePlanAccess = (feature: string) => { if (!signedIn) onSignInForExtras?.(); else onRequirePlanFeature?.(feature); };
    const [moreOpen, setMoreOpen] = useState(false);
    const [sideIdle, setSideIdle] = useState(false);
    const sideRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        let timer: number | undefined;
        const wake = () => {
            setSideIdle(false);
            window.clearTimeout(timer);
            if (languageOpen || moreOpen || keepSideVisible) return;
            timer = window.setTimeout(() => {
                if (!sideRef.current?.contains(document.activeElement)) setSideIdle(true);
            }, 4000);
        };
        wake();
        document.addEventListener('pointerdown', wake, { passive: true });
        document.addEventListener('pointermove', wake, { passive: true });
        document.addEventListener('keydown', wake);
        document.addEventListener('focusin', wake);
        return () => {
            window.clearTimeout(timer);
            document.removeEventListener('pointerdown', wake);
            document.removeEventListener('pointermove', wake);
            document.removeEventListener('keydown', wake);
            document.removeEventListener('focusin', wake);
        };
    }, [languageOpen, moreOpen, activitySignal, keepSideVisible]);
    const moreRef = useRef<HTMLDivElement>(null);
    const moreButtonRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!moreOpen) return;
        const onPointerDown = (event: PointerEvent) => {
            if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { setMoreOpen(false); moreButtonRef.current?.focus(); }
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [moreOpen]);
    return (
        <div className="control-bar" role="group" aria-label="Meeting controls">
            <div className="controls-left" ref={sideRef} data-idle={sideIdle}>
                <ToggleControl on={!audioMuted} label="Mic" title={audioMuted ? 'Unmute' : 'Mute'}
                    iconOn="mic" iconOff="mic_off" offTone="danger" stateClass={audioMuted ? 'active-muted' : ''} onToggle={onToggleAudio} />
                <ToggleControl on={!videoOff} label="Camera" title={videoOff ? 'Start video' : 'Stop video'}
                    iconOn="videocam" iconOff="videocam_off" offTone="danger" stateClass={videoOff ? 'active-muted' : ''} onToggle={onToggleVideo} />
                {onToggleCaptions && (
                    <ToggleControl on={captionsOn} label="Captions" locked={captionsLocked} title={captionsLocked ? `AI captions require ${minimumPlan('ai_captions', 'starter')}` : captionsOn ? 'Turn off captions' : `Turn on captions${languageLabel ? ` (${languageLabel})` : ''}`}
                        iconOn="closed_caption" iconOff="closed_caption_disabled" stateClass={captionsOn ? 'active' : ''} onToggle={() => { setMoreOpen(false); if (captionsLocked) onRequirePlanFeature?.('ai_captions'); else onToggleCaptions(); }} badge={captionsOn ? languageCode : undefined} />
                )}
            </div>

            <div className="controls-center">
                <ToggleControl on={screenSharing} label="Share" title={screenSharing ? 'Stop presenting' : 'Present your screen'}
                    iconOn="stop_screen_share" iconOff="screen_share" stateClass={screenSharing ? 'active-sharing' : ''} onToggle={onToggleScreen} />
                {onOpenInvite && (
                    <button
                        type="button"
                        className="ctrl-btn"
                        aria-label="Invite people"
                        data-tip="Invite people"
                        onClick={onOpenInvite}
                    >
                        <span className="ctrl-icon mi" aria-hidden="true">person_add</span>
                        <span className="ctrl-label">Invite</span>
                    </button>
                )}
                <div className="control-extra-inline"><ToggleControl on={handRaised} label="Hand" title={handRaised ? 'Lower hand' : 'Raise hand'}
                    iconOn="front_hand" iconOff="back_hand" stateClass={handRaised ? 'active' : ''} onToggle={onRaiseHand} /></div>
                {onToggleReactions && (
                    <ToggleControl on={reactionsOpen} label="React" title={reactionsOpen ? 'Close reactions' : 'Send a reaction'}
                        iconOn="add_reaction" iconOff="add_reaction" stateClass={reactionsOpen ? 'active' : ''} onToggle={onToggleReactions} controls="reaction-picker" />
                )}
                <ToggleControl on={participantsOpen} label="People" title="Participants"
                    iconOn="group" iconOff="group" stateClass={participantsOpen ? 'active' : ''} onToggle={onToggleParticipants} />
                <ToggleControl on={chatOpen} label="Chat" title="Chat"
                    iconOn="chat" iconOff="chat" stateClass={chatOpen ? 'active' : ''} onToggle={onToggleChat} controls="meeting-chat-panel" />
            </div>

            <div className="controls-right">
                {assistant}
                <div className="controls-more" ref={moreRef}>
                    <button ref={moreButtonRef} type="button" className={`ctrl-btn ${moreOpen ? 'active' : ''}`} aria-label="More controls" aria-expanded={moreOpen} aria-controls="meeting-more-controls" data-tip="More controls" onClick={() => { haptic('tap'); if (languageOpen) onToggleLanguage?.(); if (reactionsOpen) onToggleReactions?.(); setMoreOpen(open => !open); }}>
                        <span className="ctrl-icon mi" aria-hidden="true">more_horiz</span>
                    </button>
                    {moreOpen && <div id="meeting-more-controls" className="meeting-more-panel" role="group" aria-label="Extra meeting controls">
                        {!signedIn && onSignInForExtras && <RestrictedFeatureButton label="Meeting assistant" icon="support_agent" requirement="Sign in"
                            onResolve={() => { setMoreOpen(false); onSignInForExtras(); }} />}
                        {onToggleActivities && <button type="button" aria-expanded={activitiesOpen} aria-controls="meeting-activities" onClick={() => { setMoreOpen(false); onToggleActivities(); }}><span className="mi" aria-hidden="true">dashboard</span>Activities</button>}
                        <RestrictedFeatureButton label="Host controls" icon="admin_panel_settings" active={hostToolsOpen} requirement={!onToggleHostTools ? 'Host or co-host only' : undefined}
                            onActivate={() => { setMoreOpen(false); onToggleHostTools?.(); }} onResolve={() => { setMoreOpen(false); onExplainAccess?.('Only the host or co-host can manage meeting settings. Ask the host if you need access.'); }} />
                        <RestrictedFeatureButton label={isRecording ? 'Stop recording' : 'Record meeting'} icon={isRecording ? 'stop_circle' : 'fiber_manual_record'} active={isRecording} requirement={recordingRequirement}
                            onActivate={() => { setMoreOpen(false); onToggleRecording(); }}
                            onResolve={() => { setMoreOpen(false); if (!signedIn) onSignInForExtras?.(); else if (!canRecord) onExplainAccess?.('Only the signed-in meeting host can record. Upgrading does not change your meeting role.'); else onRequirePlanFeature?.('cloud_recording'); }} />
                        {(onOpenEffects || onSignInForExtras) && <RestrictedFeatureButton label="Backgrounds and effects" icon="background_replace" active={effectsOn} requirement={effectsRequirement}
                            onActivate={() => { setMoreOpen(false); onOpenEffects?.(); }} onResolve={() => { setMoreOpen(false); resolvePlanAccess('background_effects'); }} />}
                        {onTogglePictureInPicture && <button type="button" aria-pressed={pictureInPicture} onClick={() => { setMoreOpen(false); onTogglePictureInPicture(); }}><span className="mi" aria-hidden="true">picture_in_picture_alt</span>{pictureInPicture ? 'Close floating view' : 'Open floating view'}</button>}
                        {onToggleFullscreen && <button type="button" aria-pressed={fullscreen} onClick={() => { setMoreOpen(false); onToggleFullscreen(); }}><span className="mi" aria-hidden="true">{fullscreen ? 'fullscreen_exit' : 'fullscreen'}</span>{fullscreen ? 'Exit full screen' : 'Full screen'}</button>}
                        {(onToggleLanguage || onSignInForExtras) && <RestrictedFeatureButton label="Captions and language settings" icon="translate" active={languageOpen} requirement={languageRequirement}
                            onActivate={() => { setMoreOpen(false); onToggleLanguage?.(); }} onResolve={() => { setMoreOpen(false); resolvePlanAccess('ai_captions'); }} />}
                        {onReportProblem && <button type="button" onClick={() => { setMoreOpen(false); onReportProblem(); }}><span className="mi" aria-hidden="true">feedback</span>Report a problem</button>}
                        <h3>Microphone noise</h3>
                        <div className="meeting-view-options" role="group" aria-label="Microphone noise suppression">
                            <button type="button" aria-pressed={noiseMode === 'standard'} onClick={() => onChangeNoiseMode?.('standard')}><span className="mi" aria-hidden="true">graphic_eq</span>Noise suppression</button>
                            <RestrictedFeatureButton label="AI noise suppression" icon="auto_awesome" active={noiseMode === 'ai'} requirement={noiseRequirement}
                                onActivate={() => onChangeNoiseMode?.(noiseMode === 'ai' ? 'standard' : 'ai')} onResolve={() => { setMoreOpen(false); resolvePlanAccess('ai_noise_suppression'); }} />
                            <button type="button" aria-pressed={noiseMode === 'off'} onClick={() => onChangeNoiseMode?.('off')}><span className="mi" aria-hidden="true">volume_off</span>Off</button>
                        </div>
                        <h3>Audio output</h3>
                        {audioOutputSupported ? <>
                            <label className="meeting-audio-output"><span>Play meeting audio on</span>
                                <select value={audioOutputId} onChange={event => onAudioOutputChange?.(event.target.value)}>
                                    <option value="">System default</option>
                                    {audioOutputDevices.filter(device => device.deviceId && device.deviceId !== 'default').map(device =>
                                        <option key={device.deviceId} value={device.deviceId}>{device.label || 'Audio device'}</option>)}
                                </select>
                            </label>
                            {onChooseAudioOutput && <button type="button" onClick={onChooseAudioOutput}><span className="mi" aria-hidden="true">speaker</span>Choose audio device</button>}
                        </> : <p className="meeting-more-hint">This browser uses your phone’s audio route. Change speaker or headphones from your device’s audio controls.</p>}
                        <h3>Layout</h3>
                        <div className="meeting-view-options" role="group" aria-label="Meeting layout">
                            {VIEWS.map(([view, icon, label]) => <button type="button" key={view} aria-pressed={viewMode === view} onClick={() => onChangeView(view)}><span className="mi" aria-hidden="true">{icon}</span>{label}</button>)}
                        </div>
                        {onChangeTilesPerPage && <label className="meeting-tiles-option"><span>Tiles per page</span>
                            <select value={String(tilesPerPage)} onChange={event => onChangeTilesPerPage(event.target.value === 'auto' ? 'auto' : Number(event.target.value) as TilesPerPage)}>
                                {TILE_OPTIONS.map(option => <option key={String(option)} value={String(option)}>{option === 'auto' ? 'Auto (fits your screen)' : `Up to ${option}`}</option>)}
                            </select></label>}
                        <p className="meeting-more-hint">Muted-mic reminders analyse sound locally. Nothing is saved or sent.</p>
                        <div className="meeting-more-mobile-actions">
                            {onToggleCaptions && <button type="button" aria-pressed={captionsOn} aria-disabled={captionsLocked || undefined} className={captionsLocked ? 'is-feature-locked' : ''} onClick={() => { setMoreOpen(false); if (captionsLocked) onRequirePlanFeature?.('ai_captions'); else onToggleCaptions(); }}><span className="mi" aria-hidden="true">closed_caption</span>{captionsOn ? 'Turn off captions' : 'Turn on captions'}{captionsLocked && <span className="mi ctrl-plan-lock" aria-hidden="true">lock</span>}</button>}
                            <button type="button" onClick={() => { setMoreOpen(false); onToggleScreen(); }}><span className="mi" aria-hidden="true">screen_share</span>{screenSharing ? 'Stop presenting' : 'Present screen'}</button>
                            {onOpenInvite && <button type="button" onClick={() => { setMoreOpen(false); onOpenInvite(); }}><span className="mi" aria-hidden="true">person_add</span>Invite people</button>}
                            {onToggleReactions && <button type="button" onClick={() => { setMoreOpen(false); onToggleReactions(); }}><span className="mi" aria-hidden="true">add_reaction</span>Reactions</button>}
                            <button type="button" onClick={() => { setMoreOpen(false); onToggleParticipants(); }}><span className="mi" aria-hidden="true">group</span>Participants</button>
                            <button type="button" onClick={() => { setMoreOpen(false); onToggleChat(); }}><span className="mi" aria-hidden="true">chat</span>Chat</button>

                            <button type="button" aria-pressed={handRaised} onClick={() => { onRaiseHand(); setMoreOpen(false); moreButtonRef.current?.focus(); }}><span className="mi" aria-hidden="true">front_hand</span>{handRaised ? 'Lower hand' : 'Raise hand'}</button>
                        </div>
                    </div>}
                </div>
                <button type="button" className="ctrl-btn leave-btn" onClick={() => { haptic('warning'); onLeave(); }} data-tip="Leave meeting">
                    <span className="ctrl-icon mi" aria-hidden="true">call_end</span>
                    <span className="ctrl-label">Leave</span>
                </button>
            </div>
        </div>
    );
}
