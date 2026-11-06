/** All settings come from env so the same build runs at every branch. */
function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env ${name}`);
  return v;
}

export const config = {
  /** Branch/site id, used for branch-to-branch routing and logs. */
  site: req("BRIDGE_SITE", "hq"),
  http: { port: Number(req("BRIDGE_HTTP_PORT", "4600")) },
  /** IP that FreeSWITCH can reach mediasoup PlainTransports on. */
  rtp: {
    listenIp: req("BRIDGE_RTP_LISTEN_IP", "0.0.0.0"),
    announcedIp: req("BRIDGE_RTP_ANNOUNCED_IP", "127.0.0.1"),
  },
  freeswitch: {
    sipHost: req("FS_SIP_HOST", "127.0.0.1:5090"), // the 'qsvc-bridge' sofia profile (ACL-trusted)
    eslHost: req("FS_ESL_HOST", "127.0.0.1"),
    eslPort: Number(req("FS_ESL_PORT", "8021")),
    eslPassword: req("FS_ESL_PASSWORD", "ClueCon"),
    conferenceProfile: req("FS_CONF_PROFILE", "qsvc"),
  },
  drachtio: {
    host: req("DRACHTIO_HOST", "127.0.0.1"),
    port: Number(req("DRACHTIO_PORT", "9022")),
    secret: req("DRACHTIO_SECRET", "cymru"),
  },
  /** "mandatory" = SRTP (SDES) on the SFU<->MCU leg, "off" = plain RTP (lab only). */
  srtp: req("BRIDGE_SRTP", "mandatory") as "mandatory" | "off",
  /** Video codec on the SFU<->MCU leg. FreeSWITCH transcodes to H.264/H.263 for Poly. */
  legVideoCodec: req("BRIDGE_LEG_VIDEO_CODEC", "VP8") as "VP8" | "H264",
  /** Shared secret QSVC's MCU service uses to call this bridge. */
  apiToken: req("BRIDGE_API_TOKEN", ""),
  /** Base URL of the signaling service (internal RPC). */
  signalingUrl: req("SIGNALING_URL", "http://127.0.0.1:4500"),
};
