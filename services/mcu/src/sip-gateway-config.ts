/** Legacy gateway configuration shape. Defaults are deliberately unavailable;
 * runtime room-device media uses the separately configured Poly bridge.
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
    sipEnabled: false,
    sipListenPort: 5060,
    sipTlsPort: 5061,
    sipDomain: '',
    sipRegistrar: '',
    sipTransport: 'tls',

    sipTrunkEnabled: false,
    sipTrunkProvider: 'twilio',
    pstnDialInNumbers: [],

    h323Enabled: false,
    h323ListenPort: 1720,
    h323GatekeeperMode: 'discover',

    videoCodecs: [],
    audioCodecs: [],
    preferredVideoCodec: '',
    preferredAudioCodec: '',

    rtpPortRange: { min: 20000, max: 30000 },
    srtpEnabled: false,
    dtmfMode: 'rfc2833',

    // This legacy config is not a device certification matrix. Populate only
    // from the deployed gateway's negotiated capabilities and test evidence.
    endpointProfiles: [],
};

/** Get dial-in information for a meeting. */
export function getMeetingDialInfo(meetingCode: string) {
    return {
        enabled: false,
        sipUri: null,
        h323Alias: null,
        h323IpDial: null,
        pstnNumbers: [],
        conferenceId: null,
        reason: 'No gateway route is configured by services/mcu. Use the separately configured Poly bridge deployment.',
    };
}
