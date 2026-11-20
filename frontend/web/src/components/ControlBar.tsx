import { useEffect, useRef, useState, type ReactNode } from 'react';
import { haptic } from '../lib/haptics';
import AnimatedNumber from './AnimatedNumber';
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
    unreadChat?: number;
    permissions?: { key: string; label: string; allowed: boolean; unread: boolean }[];
    onReviewPermission?: (key: string) => void;
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
    onOpenBreakouts?: () => void;
    onOpenQuality?: () => void;
    onOpenMultiCamera?: () => void;
    onRecordLocally?: () => void;
    tilesPerPage?: TilesPerPage;
    onChangeTilesPerPage?: (value: TilesPerPage) => void;
    audioOutputId?: string;
    audioOutputDevices?: Array<{ deviceId: string; label: string }>;
    audioOutputSupported?: boolean;
    onAudioOutputChange?: (deviceId: string) => void;
    onChooseAudioOutput?: () => void;
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
    onToggle: () => void;
    controls?: string;
    /** tiny text badge on the icon, e.g. language code "HI" */
    badge?: string;
    unread?: string;
}

const VIEWS = [['auto', 'auto_awesome_mosaic', 'Auto'], ['tiled', 'grid_view', 'Tiled'], ['spotlight', 'crop_landscape', 'Spotlight'], ['sidebar', 'view_sidebar', 'Sidebar']] as const;
const TILE_OPTIONS: TilesPerPage[] = ['auto', 4, 9, 16, 25, 49];

function ToggleControl({ on, label, title, iconOn, iconOff, stateClass = '', locked = false, onToggle, controls, badge, unread }: ToggleProps) {
    return (
        <button
            type="button"
            className={`ctrl-btn ctrl-toggle ${stateClass} ${locked ? 'is-locked' : ''} ${on ? 'is-on' : 'is-off'}`}
            aria-label={title}
            aria-pressed={controls ? undefined : on}
            aria-expanded={controls ? on : undefined}
            aria-controls={controls}
            data-tip={title}
            onClick={() => { haptic(locked ? 'tap' : on ? 'toggleOff' : 'toggleOn'); onToggle(); }}
        >
            <span className="ctrl-icon mi" aria-hidden="true">{on ? iconOn : iconOff}</span>
            {unread && <span className="meeting-unread-badge" aria-hidden="true">{unread}</span>}
            {badge && <span className="ctrl-badge" aria-hidden="true">{badge}</span>}
            <span className="ctrl-label">{label}</span>
            {locked && <span className="mi ctrl-plan-lock" aria-hidden="true">lock</span>}
        </button>
    );
}

export function RestrictedFeatureButton({ label, icon, active, requirement, onActivate, onResolve }: {
    label: string; icon: string; active?: boolean; requirement?: string;
    onActivate?: () => void; onResolve?: () => void;
}) {
    return <button type="button" title={requirement} aria-label={requirement ? `${label}. ${requirement}.` : undefined}
        aria-pressed={active} className={requirement ? 'is-feature-locked' : undefined}
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
    chatOpen, unreadChat = 0, permissions = [], onReviewPermission, participantsOpen, handRaised, reactionsOpen = false, languageOpen = false, languageLabel, languageCode,
    onToggleAudio, onToggleVideo, onToggleScreen, onOpenInvite,
    onToggleChat, onToggleParticipants, onRaiseHand, onToggleReactions, onToggleLanguage,
    captionsOn = false, onToggleCaptions, pictureInPicture = false, onTogglePictureInPicture, fullscreen = false, onToggleFullscreen, effectsOn = false, onOpenEffects, onReportProblem, onOpenBreakouts, onOpenQuality, onOpenMultiCamera, onRecordLocally,
    tilesPerPage = 'auto', onChangeTilesPerPage,
    audioOutputId = '', audioOutputDevices = [], audioOutputSupported = false, onAudioOutputChange, onChooseAudioOutput,
    onLeave, viewMode, onChangeView,
}: Props) {
    function minimumPlan(feature: string, fallback: string) {
        const value = featureMinimumPlans[feature] || fallback;
        return value.charAt(0).toUpperCase() + value.slice(1);
    }
    const effectsRequirement = !signedIn ? `Sign in · ${minimumPlan('background_effects', 'basic')}` : effectsLocked ? `${minimumPlan('background_effects', 'basic')} plan` : undefined;
    const noiseRequirement = !signedIn ? `Sign in · ${minimumPlan('ai_noise_suppression', 'basic')}` : aiNoiseSuppressionLocked ? `${minimumPlan('ai_noise_suppression', 'basic')} plan` : undefined;
    const languageRequirement = !signedIn ? 'Sign in to choose your language' : undefined;
    const recordingRequirement = isRecording ? undefined : !signedIn ? `Sign in as host · ${minimumPlan('cloud_recording', 'basic')}` : !canRecord ? `Host only · ${minimumPlan('cloud_recording', 'basic')}` : recordingLocked ? `${minimumPlan('cloud_recording', 'basic')} plan` : undefined;
    const resolvePlanAccess = (feature: string) => { if (!signedIn) onSignInForExtras?.(); else onRequirePlanFeature?.(feature); };
    const chatCount = unreadChat > 99 ? '99+' : String(unreadChat);
    const permissionCount = permissions.filter(permission => permission.unread).length;
    const chatTitle = unreadChat ? `Chat, ${unreadChat} unread` : 'Chat';
    const moreTitle = permissionCount ? `More controls, ${permissionCount} new ${permissionCount === 1 ? 'permission' : 'permissions'}` : 'More controls';
    const [moreOpen, setMoreOpen] = useState(false);
    const moreRef = useRef<HTMLDivElement>(null);
    const moreButtonRef = useRef<HTMLButtonElement>(null);
    const closeMore = () => {
        if (moreRef.current?.contains(document.activeElement)) moreButtonRef.current?.focus();
        setMoreOpen(false);
    };
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
            <div className="controls-left">
                <ToggleControl on={!audioMuted} label="Mic" title={audioMuted ? 'Unmute' : 'Mute'}
                    iconOn="mic" iconOff="mic_off" stateClass={audioMuted ? 'active-muted' : ''} onToggle={onToggleAudio} />
                <ToggleControl on={!videoOff} label="Camera" title={videoOff ? 'Start video' : 'Stop video'}
                    iconOn="videocam" iconOff="videocam_off" stateClass={videoOff ? 'active-muted' : ''} onToggle={onToggleVideo} />
                {onToggleCaptions && (
                    <ToggleControl on={captionsOn} label="Captions" locked={captionsLocked} title={captionsLocked ? `AI captions require ${minimumPlan('ai_captions', 'starter')}` : captionsOn ? 'Turn off captions' : `Turn on captions${languageLabel ? ` (${languageLabel})` : ''}`}
                        iconOn="closed_caption" iconOff="closed_caption_disabled" stateClass={`control-extra-inline ${captionsOn ? 'active' : ''}`} onToggle={() => { setMoreOpen(false); if (captionsLocked) onRequirePlanFeature?.('ai_captions'); else onToggleCaptions(); }} badge={captionsOn ? languageCode : undefined} />
                )}
            </div>

            <div className="controls-center">
                <ToggleControl on={screenSharing} label="Share" title={screenSharing ? 'Stop presenting' : 'Present your screen'}
                    iconOn="stop_screen_share" iconOff="screen_share" stateClass={screenSharing ? 'active-sharing' : ''} onToggle={onToggleScreen} />
                {onOpenInvite && (
                    <button
                        type="button"
                        className="ctrl-btn control-extra-inline"
                        aria-label="Invite people"
                        data-tip="Invite people"
                        onClick={onOpenInvite}
                    >
                        <span className="ctrl-icon mi" aria-hidden="true">person_add</span>
                        <span className="ctrl-label">Invite</span>
                    </button>
                )}
                <ToggleControl on={handRaised} label="Hand" title={handRaised ? 'Lower hand' : 'Raise hand'}
                    iconOn="front_hand" iconOff="back_hand" stateClass={`control-extra-inline ${handRaised ? 'active' : ''}`} onToggle={onRaiseHand} />
                {onToggleReactions && (
                    <ToggleControl on={reactionsOpen} label="React" title={reactionsOpen ? 'Close reactions' : 'Send a reaction'}
                        iconOn="add_reaction" iconOff="add_reaction" stateClass={`control-extra-inline ${reactionsOpen ? 'active' : ''}`} onToggle={onToggleReactions} controls="reaction-picker" />
                )}
                <ToggleControl on={participantsOpen} label="People" title="Participants"
                    iconOn="group" iconOff="group" controls="meeting-participants-panel" stateClass={`control-extra-inline ${participantsOpen ? 'active' : ''}`} onToggle={onToggleParticipants} />
                <ToggleControl on={chatOpen} label="Chat" title={chatTitle} unread={unreadChat ? chatCount : undefined}
                    iconOn="chat" iconOff="chat" stateClass={`control-chat ${chatOpen ? 'active' : ''}`} onToggle={onToggleChat} controls="meeting-chat-panel" />
            </div>

            <div className="controls-right">
                {assistant}
                <div className="controls-more" ref={moreRef}>
                    <button ref={moreButtonRef} type="button" className={`ctrl-btn ${moreOpen ? 'active' : ''}`} aria-label={moreTitle} aria-expanded={moreOpen} aria-controls="meeting-more-controls" data-tip="More controls" onClick={() => { haptic('tap'); setMoreOpen(open => !open); }}>
                        <span className="ctrl-icon mi" aria-hidden="true">more_horiz</span>
                        {permissionCount > 0 && <span className="meeting-unread-badge" aria-hidden="true"><AnimatedNumber value={permissionCount} /></span>}
                        {!permissionCount && unreadChat > 0 && <span className="meeting-unread-badge meeting-overflow-chat-badge" aria-hidden="true"><AnimatedNumber value={Math.min(unreadChat, 99)} />{unreadChat > 99 ? '+' : ''}</span>}
                    </button>
                    {moreOpen && <div id="meeting-more-controls" className="meeting-more-panel" role="group" aria-label="Extra meeting controls">
                        {permissions.length > 0 && <details className="meeting-permission-settings" open={permissionCount > 0 || undefined}>
                            <summary><span className="mi" aria-hidden="true">settings</span>Permissions
                                {permissionCount > 0 && <span className="meeting-menu-count"><AnimatedNumber value={permissionCount} /> new</span>}
                            </summary>
                            <ul>{permissions.map(permission => <li key={permission.key} data-unread={permission.unread || undefined}>
                                <span>{permission.label}<small>{permission.allowed ? 'Allowed' : 'Restricted'}</small></span>
                                {permission.unread && <button type="button" aria-label={`Mark ${permission.label} as reviewed`}
                                    onClick={event => {
                                        event.currentTarget.closest('details')?.querySelector('summary')?.focus();
                                        onReviewPermission?.(permission.key);
                                    }}>Mark reviewed</button>}
                            </li>)}</ul>
                        </details>}
                        <div className="meeting-more-mobile-actions">
                            {onToggleCaptions && <RestrictedFeatureButton label={captionsOn ? 'Turn off captions' : 'Turn on captions'} icon="closed_caption" active={captionsOn}
                                requirement={captionsLocked ? `${minimumPlan('ai_captions', 'starter')} plan` : undefined}
                                onActivate={() => { closeMore(); onToggleCaptions(); }}
                                onResolve={() => { closeMore(); onRequirePlanFeature?.('ai_captions'); }} />}
                            {onOpenInvite && <button type="button" onClick={() => { closeMore(); onOpenInvite(); }}><span className="mi" aria-hidden="true">person_add</span>Invite people</button>}
                            {onToggleReactions && <button type="button" aria-expanded={reactionsOpen} aria-controls="reaction-picker" onClick={() => { closeMore(); onToggleReactions(); }}><span className="mi" aria-hidden="true">add_reaction</span>Reactions</button>}
                            <button type="button" aria-expanded={participantsOpen} aria-controls="meeting-participants-panel" onClick={() => { closeMore(); onToggleParticipants(); }}><span className="mi" aria-hidden="true">group</span>Participants</button>
                            <button type="button" className="control-chat-overflow" aria-label={chatTitle} aria-expanded={chatOpen} aria-controls="meeting-chat-panel" onClick={() => { closeMore(); onToggleChat(); }}><span className="mi" aria-hidden="true">chat</span>Chat{unreadChat > 0 && <span className="meeting-menu-count" aria-hidden="true"><AnimatedNumber value={Math.min(unreadChat, 99)} />{unreadChat > 99 ? '+' : ''}</span>}</button>
                            <button type="button" aria-pressed={handRaised} onClick={() => { closeMore(); onRaiseHand(); }}><span className="mi" aria-hidden="true">front_hand</span>{handRaised ? 'Lower hand' : 'Raise hand'}</button>
                        </div>
                        {!signedIn && onSignInForExtras && <RestrictedFeatureButton label="Meeting assistant" icon="support_agent" requirement="Sign in"
                            onResolve={() => { closeMore(); onSignInForExtras(); }} />}
                        {onToggleActivities && <button type="button" aria-expanded={activitiesOpen} aria-controls="meeting-activities" onClick={() => { closeMore(); onToggleActivities(); }}><span className="mi" aria-hidden="true">dashboard</span>Activities</button>}
                        <RestrictedFeatureButton label="Host controls" icon="admin_panel_settings" active={hostToolsOpen} requirement={!onToggleHostTools ? 'Host or co-host only' : undefined}
                            onActivate={() => { closeMore(); onToggleHostTools?.(); }} onResolve={() => { closeMore(); onExplainAccess?.('Only the host or co-host can manage meeting settings. Ask the host if you need access.'); }} />
                        <RestrictedFeatureButton label={isRecording ? 'Stop recording' : 'Record meeting'} icon={isRecording ? 'stop_circle' : 'fiber_manual_record'} active={isRecording} requirement={recordingRequirement}
                            onActivate={() => { closeMore(); onToggleRecording(); }}
                            onResolve={() => { closeMore(); if (!signedIn) onSignInForExtras?.(); else if (!canRecord) onExplainAccess?.('Only the signed-in meeting host can record. Upgrading does not change your meeting role.'); else onRequirePlanFeature?.('cloud_recording'); }} />
                        {(onOpenEffects || onSignInForExtras) && <RestrictedFeatureButton label="Backgrounds and effects" icon="background_replace" active={effectsOn} requirement={effectsRequirement}
                            onActivate={() => { closeMore(); onOpenEffects?.(); }} onResolve={() => { closeMore(); resolvePlanAccess('background_effects'); }} />}
                        {onTogglePictureInPicture && <button type="button" aria-pressed={pictureInPicture} onClick={() => { closeMore(); onTogglePictureInPicture(); }}><span className="mi" aria-hidden="true">picture_in_picture_alt</span>{pictureInPicture ? 'Close floating view' : 'Open floating view'}</button>}
                        {onToggleFullscreen && <button type="button" aria-pressed={fullscreen} onClick={() => { closeMore(); onToggleFullscreen(); }}><span className="mi" aria-hidden="true">{fullscreen ? 'fullscreen_exit' : 'fullscreen'}</span>{fullscreen ? 'Exit full screen' : 'Full screen'}</button>}
                        {(onToggleLanguage || onSignInForExtras) && <RestrictedFeatureButton label="Captions and language settings" icon="translate" active={languageOpen} requirement={languageRequirement}
                            onActivate={() => { closeMore(); onToggleLanguage?.(); }} onResolve={() => { closeMore(); resolvePlanAccess('ai_captions'); }} />}
                        {onOpenBreakouts && <button type="button" onClick={() => { closeMore(); onOpenBreakouts(); }}><span className="mi" aria-hidden="true">workspaces</span>Breakout rooms</button>}
                        {onOpenQuality && <button type="button" onClick={() => { closeMore(); onOpenQuality(); }}><span className="mi" aria-hidden="true">monitoring</span>Connection quality</button>}
                        {onOpenMultiCamera && <button type="button" onClick={() => { closeMore(); onOpenMultiCamera(); }}><span className="mi" aria-hidden="true">video_camera_front</span>Additional cameras</button>}
                        {onRecordLocally && canRecord && <button type="button" onClick={() => { closeMore(); onRecordLocally(); }}><span className="mi" aria-hidden="true">save</span>{isRecording ? 'Stop recording' : 'Record on this device'}</button>}
                        {onReportProblem && <button type="button" onClick={() => { closeMore(); onReportProblem(); }}><span className="mi" aria-hidden="true">feedback</span>Report a problem</button>}
                        <h3>Noise reduction</h3>
                        <div className="meeting-noise-options" role="group" aria-label="Microphone noise reduction">
                            <button type="button" aria-pressed={noiseMode === 'standard'} onClick={() => onChangeNoiseMode?.('standard')}><span className="mi" aria-hidden="true">graphic_eq</span>Standard</button>
                            <RestrictedFeatureButton label="AI noise reduction" icon="auto_awesome" active={noiseMode === 'ai'} requirement={noiseRequirement}
                                onActivate={() => onChangeNoiseMode?.('ai')} onResolve={() => { closeMore(); resolvePlanAccess('ai_noise_suppression'); }} />
                            <button type="button" aria-pressed={noiseMode === 'off'} onClick={() => onChangeNoiseMode?.('off')}><span className="mi" aria-hidden="true">volume_off</span>Off</button>
                        </div>
                        <h3>Audio output</h3>
                        {audioOutputSupported ? <>
                            <label className="meeting-audio-output"><span>Speaker or headphones</span>
                                <select value={audioOutputId} onChange={event => onAudioOutputChange?.(event.target.value)}>
                                    <option value="">System default</option>
                                    {audioOutputDevices.filter(device => device.deviceId && device.deviceId !== 'default').map(device =>
                                        <option key={device.deviceId} value={device.deviceId}>{device.label || 'Audio device'}</option>)}
                                </select>
                            </label>
                            {onChooseAudioOutput && <button type="button" onClick={onChooseAudioOutput}><span className="mi" aria-hidden="true">speaker</span>Choose audio device</button>}
                        </> : <p className="meeting-more-hint">Use your device’s audio controls to switch speakers or headphones.</p>}
                        <h3>Layout</h3>
                        <div className="meeting-view-options" role="group" aria-label="Meeting layout">
                            {VIEWS.map(([view, icon, label]) => <button type="button" key={view} aria-pressed={viewMode === view} onClick={() => onChangeView(view)}><span className="mi" aria-hidden="true">{icon}</span>{label}</button>)}
                        </div>
                        {onChangeTilesPerPage && <label className="meeting-tiles-option"><span>Tiles per page</span>
                            <select value={String(tilesPerPage)} onChange={event => onChangeTilesPerPage(event.target.value === 'auto' ? 'auto' : Number(event.target.value) as TilesPerPage)}>
                                {TILE_OPTIONS.map(option => <option key={String(option)} value={String(option)}>{option === 'auto' ? 'Auto (fits your screen)' : `Up to ${option}`}</option>)}
                            </select></label>}
                        <p className="meeting-more-hint">Muted-mic reminders analyse sound locally. Nothing is saved or sent.</p>
                    </div>}
                </div>
                <button type="button" className="ctrl-btn leave-btn" aria-label="Leave meeting" onClick={() => { haptic('warning'); onLeave(); }} data-tip="Leave meeting">
                    <span className="ctrl-icon mi" aria-hidden="true">call_end</span>
                    <span className="ctrl-label">Leave</span>
                </button>
            </div>
        </div>
    );
}
