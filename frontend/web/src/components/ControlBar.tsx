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
    onLeave: () => void;
}

export default function ControlBar({
    audioMuted,
    videoOff,
    screenSharing,
    isRecording,
    chatOpen,
    participantsOpen,
    handRaised,
    virtualBgOn = false,
    noiseSuppressionOn = false,
    captionsOn = false,
    onToggleAudio,
    onToggleVideo,
    onToggleScreen,
    onToggleRecording,
    onToggleChat,
    onToggleParticipants,
    onRaiseHand,
    onToggleVirtualBg,
    onToggleNoiseSuppression,
    onToggleCaptions,
    onLeave,
}: Props) {
    return (
        <div className="control-bar">
            <div className="controls-left">
                <button
                    className={`ctrl-btn ${audioMuted ? 'active-muted' : ''}`}
                    onClick={onToggleAudio}
                    title={audioMuted ? 'Unmute' : 'Mute'}
                >
                    <span className="ctrl-icon">{audioMuted ? '🔇' : '🎤'}</span>
                    <span className="ctrl-label">{audioMuted ? 'Unmute' : 'Mute'}</span>
                </button>

                <button
                    className={`ctrl-btn ${videoOff ? 'active-muted' : ''}`}
                    onClick={onToggleVideo}
                    title={videoOff ? 'Start Video' : 'Stop Video'}
                >
                    <span className="ctrl-icon">{videoOff ? '📵' : '📹'}</span>
                    <span className="ctrl-label">{videoOff ? 'Start Video' : 'Stop Video'}</span>
                </button>

                {onToggleNoiseSuppression && (
                    <button
                        className={`ctrl-btn ${noiseSuppressionOn ? 'active' : ''}`}
                        onClick={onToggleNoiseSuppression}
                        title={noiseSuppressionOn ? 'Disable Noise Suppression' : 'Enable Noise Suppression'}
                    >
                        <span className="ctrl-icon">{noiseSuppressionOn ? '🔕' : '🔔'}</span>
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
                    <span className="ctrl-icon">{screenSharing ? '🛑' : '🖥️'}</span>
                    <span className="ctrl-label">{screenSharing ? 'Stop Share' : 'Share'}</span>
                </button>

                <button
                    className={`ctrl-btn ${isRecording ? 'active-recording' : ''}`}
                    onClick={onToggleRecording}
                    title={isRecording ? 'Stop Recording' : 'Start Recording'}
                >
                    <span className="ctrl-icon">{isRecording ? '⏹️' : '⏺️'}</span>
                    <span className="ctrl-label">{isRecording ? 'Stop Rec' : 'Record'}</span>
                </button>

                {onToggleVirtualBg && (
                    <button
                        className={`ctrl-btn ${virtualBgOn ? 'active' : ''}`}
                        onClick={onToggleVirtualBg}
                        title={virtualBgOn ? 'Disable Virtual Background' : 'Enable Virtual Background'}
                    >
                        <span className="ctrl-icon">{virtualBgOn ? '🖼️' : '🌄'}</span>
                        <span className="ctrl-label">{virtualBgOn ? 'BG Off' : 'BG'}</span>
                    </button>
                )}

                <button
                    className={`ctrl-btn ${handRaised ? 'active' : ''}`}
                    onClick={onRaiseHand}
                    title={handRaised ? 'Lower Hand' : 'Raise Hand'}
                >
                    <span className="ctrl-icon">{handRaised ? '🙋' : '✋'}</span>
                    <span className="ctrl-label">{handRaised ? 'Lower' : 'Raise'}</span>
                </button>

                <button
                    className={`ctrl-btn ${participantsOpen ? 'active' : ''}`}
                    onClick={onToggleParticipants}
                    title="Participants"
                >
                    <span className="ctrl-icon">👥</span>
                    <span className="ctrl-label">People</span>
                </button>

                <button
                    className={`ctrl-btn ${chatOpen ? 'active' : ''}`}
                    onClick={onToggleChat}
                    title="Chat"
                >
                    <span className="ctrl-icon">💬</span>
                    <span className="ctrl-label">Chat</span>
                </button>

                {onToggleCaptions && (
                    <button
                        className={`ctrl-btn ${captionsOn ? 'active' : ''}`}
                        onClick={onToggleCaptions}
                        title={captionsOn ? 'Disable Captions' : 'Enable Captions'}
                    >
                        <span className="ctrl-icon">{captionsOn ? '📝' : '💬'}</span>
                        <span className="ctrl-label">{captionsOn ? 'CC Off' : 'CC'}</span>
                    </button>
                )}
            </div>

            <div className="controls-right">
                <button className="ctrl-btn leave-btn" onClick={onLeave} title="Leave Meeting">
                    <span className="ctrl-icon">📞</span>
                    <span className="ctrl-label">Leave</span>
                </button>
            </div>
        </div>
    );
}
