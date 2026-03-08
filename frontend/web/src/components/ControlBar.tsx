interface Props {
    audioMuted: boolean;
    videoOff: boolean;
    screenSharing: boolean;
    isRecording: boolean;
    chatOpen: boolean;
    participantsOpen: boolean;
    handRaised: boolean;
    virtualBgOn?: boolean;
    noiseSuppressionOn?: boolean;
    captionsOn?: boolean;
    onToggleAudio: () => void;
    onToggleVideo: () => void;
    onToggleScreen: () => void;
    onToggleRecording: () => void;
    onToggleChat: () => void;
    onToggleParticipants: () => void;
    onRaiseHand: () => void;
    onToggleVirtualBg?: () => void;
    onToggleNoiseSuppression?: () => void;
    onToggleCaptions?: () => void;
    onToggleAI?: () => void;
    onLeave: () => void;
}

export default function ControlBar({
    audioMuted, videoOff, screenSharing, isRecording,
    chatOpen, participantsOpen, handRaised,
    virtualBgOn = false, noiseSuppressionOn = false, captionsOn = false,
    onToggleAudio, onToggleVideo, onToggleScreen, onToggleRecording,
    onToggleChat, onToggleParticipants, onRaiseHand,
    onToggleVirtualBg, onToggleNoiseSuppression, onToggleCaptions,
    onToggleAI, onLeave,
}: Props) {
    return (
        <div className="control-bar">
            <div className="controls-left">
                <button
                    className={`ctrl-btn ${audioMuted ? 'active-muted' : ''}`}
                    onClick={onToggleAudio}
                    title={audioMuted ? 'Unmute' : 'Mute'}
                >
                    <span className="mi">{audioMuted ? 'mic_off' : 'mic'}</span>
                    <span className="ctrl-label">{audioMuted ? 'Unmute' : 'Mute'}</span>
                </button>

                <button
                    className={`ctrl-btn ${videoOff ? 'active-muted' : ''}`}
                    onClick={onToggleVideo}
                    title={videoOff ? 'Start Video' : 'Stop Video'}
                >
                    <span className="mi">{videoOff ? 'videocam_off' : 'videocam'}</span>
                    <span className="ctrl-label">{videoOff ? 'Start' : 'Stop'}</span>
                </button>

                {onToggleNoiseSuppression && (
                    <button
                        className={`ctrl-btn ${noiseSuppressionOn ? 'active' : ''}`}
                        onClick={onToggleNoiseSuppression}
                        title={noiseSuppressionOn ? 'Disable Noise Suppression' : 'Enable Noise Suppression'}
                    >
                        <span className="mi">{noiseSuppressionOn ? 'hearing_disabled' : 'hearing'}</span>
                        <span className="ctrl-label">{noiseSuppressionOn ? 'Denoise Off' : 'Denoise'}</span>
                    </button>
                )}
            </div>

            <div className="controls-center">
                <button
                    className={`ctrl-btn ${screenSharing ? 'active-sharing' : ''}`}
                    onClick={onToggleScreen}
                    title={screenSharing ? 'Stop Sharing' : 'Share Screen'}
                >
                    <span className="mi">{screenSharing ? 'stop_screen_share' : 'screen_share'}</span>
                    <span className="ctrl-label">{screenSharing ? 'Stop' : 'Share'}</span>
                </button>

                <button
                    className={`ctrl-btn ${isRecording ? 'active-recording' : ''}`}
                    onClick={onToggleRecording}
                    title={isRecording ? 'Stop Recording' : 'Start Recording'}
                >
                    <span className="mi">{isRecording ? 'stop_circle' : 'fiber_manual_record'}</span>
                    <span className="ctrl-label">{isRecording ? 'Stop' : 'Record'}</span>
                </button>

                {onToggleVirtualBg && (
                    <button
                        className={`ctrl-btn ${virtualBgOn ? 'active' : ''}`}
                        onClick={onToggleVirtualBg}
                        title={virtualBgOn ? 'Disable Background' : 'Virtual Background'}
                    >
                        <span className="mi">{virtualBgOn ? 'wallpaper' : 'blur_on'}</span>
                        <span className="ctrl-label">{virtualBgOn ? 'BG Off' : 'BG'}</span>
                    </button>
                )}

                <button
                    className={`ctrl-btn ${handRaised ? 'active' : ''}`}
                    onClick={onRaiseHand}
                    title={handRaised ? 'Lower Hand' : 'Raise Hand'}
                >
                    <span className="mi">{handRaised ? 'front_hand' : 'back_hand'}</span>
                    <span className="ctrl-label">{handRaised ? 'Lower' : 'Raise'}</span>
                </button>

                <button
                    className={`ctrl-btn ${participantsOpen ? 'active' : ''}`}
                    onClick={onToggleParticipants}
                    title="Participants"
                >
                    <span className="mi">group</span>
                    <span className="ctrl-label">People</span>
                </button>

                <button
                    className={`ctrl-btn ${chatOpen ? 'active' : ''}`}
                    onClick={onToggleChat}
                    title="Chat"
                >
                    <span className="mi">chat</span>
                    <span className="ctrl-label">Chat</span>
                </button>

                {onToggleCaptions && (
                    <button
                        className={`ctrl-btn ${captionsOn ? 'active' : ''}`}
                        onClick={onToggleCaptions}
                        title={captionsOn ? 'Disable Captions' : 'Enable Captions'}
                    >
                        <span className="mi">{captionsOn ? 'closed_caption_disabled' : 'closed_caption'}</span>
                        <span className="ctrl-label">{captionsOn ? 'CC Off' : 'CC'}</span>
                    </button>
                )}

                {onToggleAI && (
                    <button className="ctrl-btn" onClick={onToggleAI} title="AI Assistant">
                        <span className="mi">smart_toy</span>
                        <span className="ctrl-label">AI</span>
                    </button>
                )}
            </div>

            <div className="controls-right">
                <button className="ctrl-btn leave-btn" onClick={onLeave} title="Leave Meeting">
                    <span className="mi">call_end</span>
                    <span className="ctrl-label">Leave</span>
                </button>
            </div>
        </div>
    );
}
