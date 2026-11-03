import { useEffect, useRef, useState, type ReactNode } from 'react';
import { haptic } from '../lib/haptics';

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
    onToggleRecording: () => void;
    onToggleChat: () => void;
    onToggleParticipants: () => void;
    onRaiseHand: () => void;
    onToggleReactions?: () => void;
    onToggleLanguage?: () => void;
    activitySignal?: number;
    keepSideVisible?: boolean;
    viewMode: 'gallery' | 'focus' | 'sidebar' | 'filmstrip';
    onChangeView: (view: 'gallery' | 'focus' | 'sidebar' | 'filmstrip') => void;
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
    /** 'danger' paints the off state red (mic / camera muted) */
    offTone?: 'neutral' | 'danger';
    onToggle: () => void;
    controls?: string;
    /** tiny text badge on the icon, e.g. language code "HI" */
    badge?: string;
}

const FLASH_MS = 900;
const VIEWS = [['gallery', 'grid_view', 'Gallery'], ['focus', 'person', 'Focus on me'], ['sidebar', 'view_sidebar', 'Sidebar'], ['filmstrip', 'view_carousel', 'Filmstrip']] as const;

function ToggleControl({ on, label, title, iconOn, iconOff, stateClass = '', offTone = 'neutral', onToggle, controls, badge }: ToggleProps) {
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
            className={`ctrl-btn ctrl-toggle ${stateClass} ${on ? 'is-on' : 'is-off'} ${offTone === 'danger' ? 'tone-danger' : ''} ${flash ? 'is-flashing' : ''}`}
            aria-label={title}
            aria-pressed={on}
            aria-expanded={controls ? on : undefined}
            aria-controls={controls}
            data-tip={title}
            onClick={press}
        >
            <span className="ctrl-icon mi" aria-hidden="true" key={on ? 'on' : 'off'}>{on ? iconOn : iconOff}</span>
            {badge && <span className="ctrl-badge" aria-hidden="true">{badge}</span>}
            <span className="ctrl-label">{label}</span>
            {flash && (
                <span key={flash.id} className={`ctrl-switch-flash ${flash.to ? 'to-on' : 'to-off'}`} aria-hidden="true"
                    onAnimationEnd={(e) => { if (e.target === e.currentTarget) setFlash(null); }}>
                    <i />
                </span>
            )}
        </button>
    );
}

export default function ControlBar({
    assistant,
    activitiesOpen = false, hostToolsOpen = false, onToggleActivities, onToggleHostTools,
    audioMuted, videoOff, screenSharing,
    chatOpen, participantsOpen, handRaised, reactionsOpen = false, languageOpen = false, languageLabel, languageCode,
    onToggleAudio, onToggleVideo, onToggleScreen,
    onToggleChat, onToggleParticipants, onRaiseHand, onToggleReactions, onToggleLanguage,
    onLeave, viewMode, onChangeView, activitySignal = 0, keepSideVisible = false,
}: Props) {
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
                {onToggleLanguage && (
                    <ToggleControl on={languageOpen} label={languageLabel || 'Language'} title={`Language, captions & audio${languageLabel ? `: ${languageLabel}` : ''}`}
                        iconOn="translate" iconOff="translate" stateClass={`ctrl-language ${languageOpen ? 'active' : ''}`} onToggle={() => { setMoreOpen(false); onToggleLanguage(); }} controls="meeting-language-settings" badge={languageCode} />
                )}
            </div>

            <div className="controls-center">
                <ToggleControl on={screenSharing} label="Share" title={screenSharing ? 'Stop presenting' : 'Present your screen'}
                    iconOn="stop_screen_share" iconOff="screen_share" stateClass={screenSharing ? 'active-sharing' : ''} onToggle={onToggleScreen} />
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
                        {onToggleActivities && <button type="button" aria-expanded={activitiesOpen} aria-controls="meeting-activities" onClick={() => { setMoreOpen(false); onToggleActivities(); }}><span className="mi" aria-hidden="true">dashboard</span>Activities</button>}
                        {onToggleHostTools && <button type="button" aria-expanded={hostToolsOpen} aria-controls="meeting-host-tools" onClick={() => { setMoreOpen(false); onToggleHostTools(); }}><span className="mi" aria-hidden="true">admin_panel_settings</span>Host controls</button>}
                        <h3>View</h3>
                        <div className="meeting-view-options" role="group" aria-label="Meeting view">
                            {VIEWS.map(([view, icon, label]) => <button type="button" key={view} aria-pressed={viewMode === view} onClick={() => onChangeView(view)}><span className="mi" aria-hidden="true">{icon}</span>{label}</button>)}
                        </div>
                        <p className="meeting-more-hint">Muted-mic reminders analyse sound locally. Nothing is saved or sent.</p>
                        <div className="meeting-more-mobile-actions">
                            {onToggleLanguage && <button type="button" onClick={() => { setMoreOpen(false); onToggleLanguage(); }}><span className="mi" aria-hidden="true">translate</span>Language and captions</button>}
                            <button type="button" onClick={() => { setMoreOpen(false); onToggleScreen(); }}><span className="mi" aria-hidden="true">screen_share</span>{screenSharing ? 'Stop presenting' : 'Present screen'}</button>
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
