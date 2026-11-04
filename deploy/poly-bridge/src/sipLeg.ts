import type { types as ms } from "mediasoup";
import { randomInt, randomUUID } from "crypto";
import { config } from "./config";
import { buildOffer, parseAnswer, MLineSpec } from "./sdp";

// drachtio-srf ships without types
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Srf = require("drachtio-srf");

let srf: any;
export function sipStack(): Promise<any> {
  if (srf) return Promise.resolve(srf);
  return new Promise((resolve, reject) => {
    const s = new Srf();
    s.connect({ host: config.drachtio.host, port: config.drachtio.port, secret: config.drachtio.secret });
    s.on("connect", (_err: unknown, hp: string) => {
      console.log(`[sip] drachtio connected ${hp}`);
      srf = s;
      resolve(s);
    });
    s.on("error", (err: Error) => reject(err));
  });
}

async function plainTransport(router: ms.Router): Promise<ms.PlainTransport> {
  return router.createPlainTransport({
    listenInfo: { protocol: "udp", ip: config.rtp.listenIp, announcedAddress: config.rtp.announcedIp },
    rtcpMux: false,
    comedia: false,
    enableSrtp: config.srtp === "mandatory",
    srtpCryptoSuite: "AES_CM_128_HMAC_SHA1_80",
  });
}

function pickCodec(router: ms.Router, kind: "audio" | "video"): ms.RtpCodecCapability {
  const want = kind === "audio" ? "audio/opus" : `video/${config.legVideoCodec}`;
  const c = router.rtpCapabilities.codecs?.find((x) => x.mimeType.toLowerCase() === want.toLowerCase());
  if (!c) throw new Error(`Router has no ${want}; add it to the QSVC router mediaCodecs`);
  return c;
}

/** RTP capabilities restricted to what the MCU leg will carry (no RTX/simulcast, no DTLS). */
function legCaps(router: ms.Router): ms.RtpCapabilities {
  return {
    codecs: [pickCodec(router, "audio"), pickCodec(router, "video")].map((c) => ({ ...c, rtcpFeedback: c.rtcpFeedback?.filter((f) => f.type !== "transport-cc") })),
    headerExtensions: [],
  };
}

abstract class Leg {
  protected dialog: any;
  protected transports: ms.PlainTransport[] = [];
  closed = false;
  /** Correlates this SIP leg with its FreeSWITCH conference member (X-Qsvc-Leg-Id). */
  readonly legId = randomUUID();
  memberId?: number;
  onClose?: () => void;

  constructor(protected router: ms.Router, protected room: string, protected label: string) {}

  protected async invite(offer: string, headers: Record<string, string>): Promise<string> {
    const s = await sipStack();
    const uri = `sip:qsvc-bridge-${this.room}@${config.freeswitch.sipHost}`;
    this.dialog = await s.createUAC(uri, {
      localSdp: offer,
      headers: { From: `"${this.label}" <sip:${this.label.replace(/\W+/g, "_")}@qsvc.bridge>`, "X-Qsvc-Leg-Id": this.legId, ...(config.srtp === "off" ? { "X-Qsvc-Plain": "true" } : {}), ...headers },
    });
    this.dialog.on("destroy", () => this.close(false));
    return this.dialog.remote.sdp as string;
  }

  /** Real media check: bytes flowing in each direction on every transport. */
  async mediaStats() {
    const out = [];
    for (const t of this.transports) {
      const [st] = await t.getStats();
      out.push({ transportId: t.id, bytesSent: st?.rtpBytesSent ?? 0, bytesReceived: st?.rtpBytesReceived ?? 0 });
    }
    return out;
  }

  async close(sendBye = true) {
    if (this.closed) return;
    this.closed = true;
    if (sendBye && this.dialog) await this.dialog.destroy().catch(() => undefined);
    this.transports.forEach((t) => t.close());
    this.onClose?.();
  }
}

/**
 * UPLINK: one per browser participant. Sends that browser's mic+cam into the MCU
 * conference as a normal member, so Poly endpoints see/hear each browser user.
 */
export class UplinkLeg extends Leg {
  consumers: ms.Consumer[] = [];

  constructor(router: ms.Router, room: string, readonly peerId: string, displayName: string) {
    super(router, room, displayName);
  }

  async start(producers: { audio?: string; video?: string }) {
    const caps = legCaps(this.router);
    const lines: MLineSpec[] = [];
    for (const kind of ["audio", "video"] as const) {
      const producerId = producers[kind];
      if (!producerId) continue;
      const t = await plainTransport(this.router);
      this.transports.push(t);
      const consumer = await t.consume({ producerId, rtpCapabilities: caps, paused: true });
      this.consumers.push(consumer);
      lines.push({
        kind,
        port: t.tuple.localPort,
        rtcpPort: t.rtcpTuple?.localPort ?? t.tuple.localPort + 1,
        codec: consumer.rtpParameters.codecs[0],
        ssrc: consumer.rtpParameters.encodings?.[0]?.ssrc,
        srtp: t.srtpParameters,
      });
    }
    if (!lines.length) throw new Error("uplink with no producers");

    const answer = parseAnswer(
      await this.invite(buildOffer(config.rtp.announcedIp, `up-${this.peerId}`, lines, "sendonly"), {
        "X-Qsvc-Room": this.room,
        "X-Qsvc-Leg": "uplink",
        "X-Qsvc-Peer": this.peerId,
      })
    );
    await this.connect(answer);
  }

  private async connect(answer: ReturnType<typeof parseAnswer>) {
    for (let i = 0; i < this.transports.length; i++) {
      const a = answer[i];
      const t = this.transports[i];
      if (!a || a.rejected) throw new Error(`MCU rejected ${this.consumers[i]?.kind} m-line`);
      if (config.srtp === "mandatory" && !a.srtp) throw new Error("MCU answered without SRTP while SRTP is mandatory");
      await t.connect({ ip: a.ip, port: a.port, rtcpPort: a.rtcpPort, srtpParameters: a.srtp });
      await this.consumers[i].resume();
      if (this.consumers[i].kind === "video") {
        await this.consumers[i].requestKeyFrame();
        // Legacy Poly decoders recover slowly; nudge keyframes during the first seconds.
        for (const ms of [1000, 3000, 6000]) setTimeout(() => !this.closed && this.consumers[i].requestKeyFrame().catch(() => undefined), ms);
      }
    }
  }
}

/**
 * DOWNLINK: one per room. Receives the MCU composite (all Poly endpoints, mixed
 * by the MCU) and publishes it into the SFU as a "Poly room" peer.
 */
export class DownlinkLeg extends Leg {
  producers: ms.Producer[] = [];
  private ssrcs = { audio: randomInt(1e6, 2 ** 31), video: randomInt(1e6, 2 ** 31) };

  constructor(router: ms.Router, room: string) {
    super(router, room, "Poly room");
  }

  async start() {
    const lines: MLineSpec[] = [];
    for (const kind of ["audio", "video"] as const) {
      const t = await plainTransport(this.router);
      this.transports.push(t);
      const c = pickCodec(this.router, kind);
      lines.push({
        kind,
        port: t.tuple.localPort,
        rtcpPort: t.rtcpTuple?.localPort ?? t.tuple.localPort + 1,
        codec: { mimeType: c.mimeType, payloadType: c.preferredPayloadType!, clockRate: c.clockRate, channels: c.channels, parameters: c.parameters },
        srtp: t.srtpParameters,
      });
    }
    const answer = parseAnswer(
      await this.invite(buildOffer(config.rtp.announcedIp, `down-${this.room}`, lines, "recvonly"), {
        "X-Qsvc-Room": this.room,
        "X-Qsvc-Leg": "downlink",
        // FreeSWITCH dialplan copies these into rtp_use_ssrc / rtp_use_video_ssrc so we
        // know exactly which SSRC to expect (mediasoup producers are matched by SSRC).
        "X-Qsvc-Audio-Ssrc": String(this.ssrcs.audio),
        "X-Qsvc-Video-Ssrc": String(this.ssrcs.video),
      })
    );

    for (let i = 0; i < this.transports.length; i++) {
      const a = answer[i];
      const t = this.transports[i];
      const kind = lines[i].kind;
      if (!a || a.rejected) throw new Error(`MCU rejected downlink ${kind}`);
      if (config.srtp === "mandatory" && !a.srtp) throw new Error("MCU answered without SRTP while SRTP is mandatory");
      await t.connect({ ip: a.ip, port: a.port, rtcpPort: a.rtcpPort, srtpParameters: a.srtp });
      const c = pickCodec(this.router, kind);
      const producer = await t.produce({
        kind,
        rtpParameters: {
          codecs: [{
            mimeType: c.mimeType,
            payloadType: a.payloadType,
            clockRate: c.clockRate,
            channels: c.channels,
            parameters: c.parameters,
            rtcpFeedback: kind === "video" ? [{ type: "nack" }, { type: "nack", parameter: "pli" }, { type: "ccm", parameter: "fir" }] : [],
          }],
          encodings: [{ ssrc: a.ssrc ?? this.ssrcs[kind] }],
        },
        appData: { source: "poly-room", bridge: true },
      });
      this.producers.push(producer);
    }
  }
}
