import dotenv from 'dotenv';
import { types as msTypes } from 'mediasoup';

dotenv.config({ path: '../../.env' });

export const config = {
    port: parseInt(process.env.SFU_PORT || '4000', 10),
    announcedIp: process.env.SFU_ANNOUNCED_IP || '127.0.0.1',
    numWorkers: parseInt(process.env.SFU_NUM_WORKERS || '2', 10),
    logLevel: (process.env.SFU_LOG_LEVEL || 'warn') as msTypes.WorkerLogLevel,

    // mediasoup Worker settings
    worker: {
        logLevel: (process.env.SFU_LOG_LEVEL || 'warn') as msTypes.WorkerLogLevel,
        logTags: [
            'info',
            'ice',
            'dtls',
            'rtp',
            'srtp',
            'rtcp',
            'rtx',
            'bwe',
            'score',
            'simulcast',
            'svc',
        ] as msTypes.WorkerLogTag[],
        rtcMinPort: parseInt(process.env.SFU_MIN_PORT || '40000', 10),
        rtcMaxPort: parseInt(process.env.SFU_MAX_PORT || '49999', 10),
    },

    // Router: supported media codecs
    router: {
        mediaCodecs: [
            {
                kind: 'audio' as const,
                mimeType: 'audio/opus',
                clockRate: 48000,
                channels: 2,
            },
            {
                kind: 'video' as const,
                mimeType: 'video/VP8',
                clockRate: 90000,
                parameters: {
                    'x-google-start-bitrate': 1000,
                },
            },
            {
                kind: 'video' as const,
                mimeType: 'video/VP9',
                clockRate: 90000,
                parameters: {
                    'profile-id': 2,
                    'x-google-start-bitrate': 1000,
                },
            },
            {
                kind: 'video' as const,
                mimeType: 'video/H264',
                clockRate: 90000,
                parameters: {
                    'packetization-mode': 1,
                    'profile-level-id': '4d0032',
                    'level-asymmetry-allowed': 1,
                    'x-google-start-bitrate': 1000,
                },
            },
        ] as msTypes.RtpCodecCapability[],
    },

    // WebRtcTransport settings
    webRtcTransport: {
        listenIps: [
            {
                ip: '0.0.0.0',
                announcedIp: process.env.SFU_ANNOUNCED_IP || '127.0.0.1',
            },
        ] as msTypes.TransportListenIp[],
        initialAvailableOutgoingBitrate: 1000000,
        minimumAvailableOutgoingBitrate: 600000,
        maxSctpMessageSize: 262144,
        maxIncomingBitrate: 1500000,
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
    },

    // Redis
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
    },
};
