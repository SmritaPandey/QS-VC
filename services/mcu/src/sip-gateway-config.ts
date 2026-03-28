/**
 * SIP/H.323 Gateway Configuration for QS-VC Enterprise.
 *
 * Bridges WebRTC (SFU/MCU) ↔ SIP/H.323 legacy endpoints:
 * - Polycom HDX, VVX, Group, Trio, Studio, G7500
 * - Cisco TelePresence, SX, MX, DX, Room Kit, Board, Desk
 * - PeopleLink Ultra, Sky, Blaze, Ivory, Auro
 * - Tandberg Edge, Codec
 * - Lifesize Icon, Cloud
 * - Avaya Scopia, B-Series
 * - Huawei TE, CE Series
 * - StarLeaf GT Mini, Breeze
 *
 * Uses: Obelit / Opalvoip / Opal SIP-B2BUA for protocol bridging
 */

export interface SIPGatewayConfig {
    // SIP Settings
    sipEnabled: boolean;
    sipListenPort: number;
    sipTlsPort: number;
    sipDomain: string;
    sipRegistrar: string;
    sipOutboundProxy?: string;
    sipTransport: 'udp' | 'tcp' | 'tls' | 'ws' | 'wss';

    // SIP Trunking (PSTN)
    sipTrunkEnabled: boolean;
    sipTrunkProvider: 'twilio' | 'vonage' | 'obelit' | 'custom';
    sipTrunkHost?: string;
    sipTrunkUser?: string;
    sipTrunkPassword?: string;
    pstnDialInNumbers: { country: string; number: string }[];

    // H.323 Settings
    h323Enabled: boolean;
    h323ListenPort: number;
    h323GatekeeperAddress?: string;
    h323GatekeeperMode: 'none' | 'discover' | 'required';
    h323RegistrationId?: string;

    // Codec Negotiation
    videoCodecs: string[];
    audioCodecs: string[];
    preferredVideoCodec: string;
    preferredAudioCodec: string;

    // Media
    rtpPortRange: { min: number; max: number };
    srtpEnabled: boolean;
    dtmfMode: 'rfc2833' | 'info' | 'inband';

    // Endpoint Profiles (pre-configured for common hardware)
    endpointProfiles: EndpointProfile[];
}

export interface EndpointProfile {
    vendor: string;
    models: string[];
    defaultCodecs: string[];
    maxResolution: string;
    supportsSimulcast: boolean;
    supportsContentShare: boolean;
    h323Support: boolean;
    sipSupport: boolean;
    dualStream: boolean;         // BFCP / content sharing
    encryptionMode: 'none' | 'srtp' | 'h235';
}

export const DEFAULT_GATEWAY_CONFIG: SIPGatewayConfig = {
    sipEnabled: true,
    sipListenPort: 5060,
    sipTlsPort: 5061,
    sipDomain: 'sip.qsvc.local',
    sipRegistrar: 'sip.qsvc.local',
    sipTransport: 'tls',

    sipTrunkEnabled: true,
    sipTrunkProvider: 'twilio',
    pstnDialInNumbers: [
        { country: 'India', number: '+91-11-4000-XXXX' },
        { country: 'India (Toll-free)', number: '+91-1800-XXX-XXXX' },
        { country: 'US', number: '+1-646-XXX-XXXX' },
        { country: 'UK', number: '+44-20-XXXX-XXXX' },
        { country: 'Singapore', number: '+65-XXXX-XXXX' },
        { country: 'UAE', number: '+971-4-XXX-XXXX' },
    ],

    h323Enabled: true,
    h323ListenPort: 1720,
    h323GatekeeperMode: 'discover',

    videoCodecs: ['H.264', 'H.265', 'VP8', 'VP9', 'H.263'],
    audioCodecs: ['Opus', 'G.722', 'G.711 μ-law', 'G.711 A-law', 'AAC-LD'],
    preferredVideoCodec: 'H.264',
    preferredAudioCodec: 'Opus',

    rtpPortRange: { min: 20000, max: 30000 },
    srtpEnabled: true,
    dtmfMode: 'rfc2833',

    endpointProfiles: [
        {
            vendor: 'Polycom',
            models: ['HDX 7000/8000/9000', 'VVX 500/600', 'Group 300/500/700', 'Trio 8500/8800', 'Studio X30/X50/X70', 'G7500'],
            defaultCodecs: ['H.264', 'G.722'],
            maxResolution: '4K',
            supportsSimulcast: true,
            supportsContentShare: true,
            h323Support: true,
            sipSupport: true,
            dualStream: true,
            encryptionMode: 'srtp',
        },
        {
            vendor: 'Cisco',
            models: ['TelePresence SX10/SX20/SX80', 'MX200/MX300/MX700/MX800', 'Room Kit/Room Kit Mini/Room Kit Plus', 'Board 55/85', 'Desk Pro', 'DX70/DX80'],
            defaultCodecs: ['H.264', 'G.722'],
            maxResolution: '4K',
            supportsSimulcast: true,
            supportsContentShare: true,
            h323Support: true,
            sipSupport: true,
            dualStream: true,
            encryptionMode: 'srtp',
        },
        {
            vendor: 'PeopleLink',
            models: ['Ultra HD', 'Sky 100/200', 'Blaze 300/400/500', 'Ivory 100S', 'Auro 500'],
            defaultCodecs: ['H.264', 'G.711 A-law'],
            maxResolution: '1080p',
            supportsSimulcast: false,
            supportsContentShare: true,
            h323Support: true,
            sipSupport: true,
            dualStream: true,
            encryptionMode: 'srtp',
        },
        {
            vendor: 'Lifesize',
            models: ['Icon 300/450/500/700', 'Cloud'],
            defaultCodecs: ['H.264', 'Opus'],
            maxResolution: '4K',
            supportsSimulcast: true,
            supportsContentShare: true,
            h323Support: true,
            sipSupport: true,
            dualStream: true,
            encryptionMode: 'srtp',
        },
        {
            vendor: 'Avaya',
            models: ['Scopia XT5000', 'B179', 'IX Meeting Server'],
            defaultCodecs: ['H.264', 'G.722'],
            maxResolution: '1080p',
            supportsSimulcast: false,
            supportsContentShare: true,
            h323Support: true,
            sipSupport: true,
            dualStream: true,
            encryptionMode: 'h235',
        },
        {
            vendor: 'Huawei',
            models: ['TE30/TE40/TE50/TE60', 'CE200/CE400'],
            defaultCodecs: ['H.265', 'G.722'],
            maxResolution: '4K',
            supportsSimulcast: false,
            supportsContentShare: true,
            h323Support: true,
            sipSupport: true,
            dualStream: true,
            encryptionMode: 'srtp',
        },
    ],
};

/** Get dial-in information for a meeting. */
export function getMeetingDialInfo(meetingCode: string) {
    return {
        sipUri: `sip:${meetingCode}@${DEFAULT_GATEWAY_CONFIG.sipDomain}`,
        h323Alias: `${meetingCode}@${DEFAULT_GATEWAY_CONFIG.sipDomain}`,
        h323IpDial: `${DEFAULT_GATEWAY_CONFIG.sipDomain}##${meetingCode}`,
        pstnNumbers: DEFAULT_GATEWAY_CONFIG.pstnDialInNumbers,
        conferenceId: meetingCode.replace(/[^0-9]/g, '').slice(0, 10),
        instructions: {
            sip: `Dial ${meetingCode}@${DEFAULT_GATEWAY_CONFIG.sipDomain} from your SIP endpoint`,
            h323: `Dial ${DEFAULT_GATEWAY_CONFIG.sipDomain} and enter conference ID when prompted`,
            pstn: `Call any dial-in number and enter the conference ID followed by #`,
            webrtc: `Open the meeting link in any browser`,
        },
    };
}
