import { useRef, useEffect } from 'react';

interface Props {
    displayName: string;
    stream?: MediaStream | null;
    audioTrack?: MediaStreamTrack;
    videoTrack?: MediaStreamTrack;
    isLocal?: boolean;
    videoOff?: boolean;
}

export default function VideoTile({ displayName, stream, audioTrack, videoTrack, isLocal, videoOff }: Props) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);

    useEffect(() => {
        if (videoRef.current) {
            if (stream) {
                videoRef.current.srcObject = stream;
            } else if (videoTrack) {
                const ms = new MediaStream([videoTrack]);
                videoRef.current.srcObject = ms;
            } else {
                videoRef.current.srcObject = null;
            }
        }
    }, [stream, videoTrack]);

    useEffect(() => {
        if (audioRef.current && audioTrack && !isLocal) {
            const ms = new MediaStream([audioTrack]);
            audioRef.current.srcObject = ms;
        }
    }, [audioTrack, isLocal]);

    return (
        <div className={`video-tile ${isLocal ? 'local' : ''}`}>
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={isLocal}
                className={`tile-video ${videoOff ? 'hidden' : ''}`}
            />

            {!isLocal && <audio ref={audioRef} autoPlay />}

            {videoOff && (
                <div className="tile-avatar">
                    <div className="avatar-circle-tile">
                        {displayName[0]?.toUpperCase() || '?'}
                    </div>
                </div>
            )}

            <div className="tile-name-badge">
                <span className="mi mi-sm" style={{ color: audioTrack ? 'var(--accent-success)' : 'var(--accent-danger)' }}>
                    {audioTrack ? 'mic' : 'mic_off'}
                </span>
                <span className="tile-name">{displayName}</span>
            </div>
        </div>
    );
}
