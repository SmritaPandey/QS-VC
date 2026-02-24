import React, { useState, useEffect, useCallback } from 'react';

interface DeviceInfo {
    deviceId: string;
    label: string;
    kind: MediaDeviceKind;
}

interface Props {
    currentAudioDevice?: string;
    currentVideoDevice?: string;
    onAudioDeviceChange: (deviceId: string) => void;
    onVideoDeviceChange: (deviceId: string) => void;
    onClose: () => void;
}

const DeviceSettings: React.FC<Props> = ({
    currentAudioDevice, currentVideoDevice,
    onAudioDeviceChange, onVideoDeviceChange, onClose,
}) => {
    const [audioInputs, setAudioInputs] = useState<DeviceInfo[]>([]);
    const [audioOutputs, setAudioOutputs] = useState<DeviceInfo[]>([]);
    const [videoInputs, setVideoInputs] = useState<DeviceInfo[]>([]);
    const [selectedAudio, setSelectedAudio] = useState(currentAudioDevice || '');
    const [selectedVideo, setSelectedVideo] = useState(currentVideoDevice || '');
    const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);

    const enumerateDevices = useCallback(async () => {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setAudioInputs(devices.filter(d => d.kind === 'audioinput').map(d => ({
            deviceId: d.deviceId, label: d.label || `Microphone ${d.deviceId.slice(0, 5)}`, kind: d.kind,
        })));
        setAudioOutputs(devices.filter(d => d.kind === 'audiooutput').map(d => ({
            deviceId: d.deviceId, label: d.label || `Speaker ${d.deviceId.slice(0, 5)}`, kind: d.kind,
        })));
        setVideoInputs(devices.filter(d => d.kind === 'videoinput').map(d => ({
            deviceId: d.deviceId, label: d.label || `Camera ${d.deviceId.slice(0, 5)}`, kind: d.kind,
        })));
    }, []);

    useEffect(() => {
        enumerateDevices();
    }, [enumerateDevices]);

    // Start camera preview when video device changes
    useEffect(() => {
        let stream: MediaStream | null = null;
        const startPreview = async () => {
            if (previewStream) {
                previewStream.getTracks().forEach(t => t.stop());
            }
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: selectedVideo ? { deviceId: { exact: selectedVideo } } : true,
                    audio: false,
                });
                setPreviewStream(stream);
            } catch {
                setPreviewStream(null);
            }
        };
        startPreview();
        return () => { stream?.getTracks().forEach(t => t.stop()); };
    }, [selectedVideo]);

    const handleApply = () => {
        if (selectedAudio) onAudioDeviceChange(selectedAudio);
        if (selectedVideo) onVideoDeviceChange(selectedVideo);
        onClose();
    };

    return (
        <div className="device-settings-overlay" onClick={onClose}>
            <div className="device-settings-modal" onClick={(e) => e.stopPropagation()}>
                <div className="device-settings-header">
                    <h3>Device Settings</h3>
                    <button className="btn-close" onClick={onClose}>✕</button>
                </div>

                <div className="device-settings-body">
                    {/* Video Preview */}
                    <div className="device-preview">
                        {previewStream ? (
                            <video
                                autoPlay
                                playsInline
                                muted
                                ref={(el) => { if (el) el.srcObject = previewStream; }}
                                className="device-preview-video"
                            />
                        ) : (
                            <div className="device-preview-placeholder">No camera</div>
                        )}
                    </div>

                    {/* Camera */}
                    <div className="device-group">
                        <label>Camera</label>
                        <select
                            value={selectedVideo}
                            onChange={(e) => setSelectedVideo(e.target.value)}
                            className="device-select"
                        >
                            {videoInputs.map(d => (
                                <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Microphone */}
                    <div className="device-group">
                        <label>Microphone</label>
                        <select
                            value={selectedAudio}
                            onChange={(e) => setSelectedAudio(e.target.value)}
                            className="device-select"
                        >
                            {audioInputs.map(d => (
                                <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Speaker */}
                    <div className="device-group">
                        <label>Speaker</label>
                        <select className="device-select">
                            {audioOutputs.map(d => (
                                <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="device-settings-footer">
                    <button className="btn-cancel" onClick={onClose}>Cancel</button>
                    <button className="btn-apply" onClick={handleApply}>Apply</button>
                </div>
            </div>
        </div>
    );
};

export default DeviceSettings;
