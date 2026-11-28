import * as sdpTransform from "sdp-transform";
import type { types as ms } from "mediasoup";

export type Direction = "sendonly" | "recvonly";

export interface MLineSpec {
  kind: "audio" | "video";
  /** Port of the mediasoup PlainTransport for this m-line (rtcp = port+1, no mux). */
  port: number;
  rtcpPort: number;
  codec: ms.RtpCodecParameters;
  /** Our SSRC when we send (sendonly). */
  ssrc?: number;
  /** SDES key when SRTP is on (from PlainTransport.srtpParameters). */
  srtp?: ms.SrtpParameters;
  /** "content" marks the H.239/BFCP-equivalent screen-share video line. */
  content?: "main" | "slides";
}

/**
 * Builds a plain (non-WebRTC) SDP offer FreeSWITCH accepts:
 * no ICE, no DTLS, RTP/AVP or RTP/SAVP with SDES a=crypto.
 */
export function buildOffer(ip: string, sessionName: string, lines: MLineSpec[], dir: Direction): string {
  const now = Date.now();
  const media: any[] = lines.map((l, i) => {
    const c = l.codec;
    const enc = c.mimeType.split("/")[1];
    const m: any = {
      type: l.kind,
      port: l.port,
      protocol: l.srtp ? "RTP/SAVP" : "RTP/AVP",
      payloads: String(c.payloadType),
      rtp: [{ payload: c.payloadType, codec: enc, rate: c.clockRate, encoding: c.channels && c.channels > 1 ? c.channels : undefined }],
      fmtp: [] as any[],
      rtcp: { port: l.rtcpPort },
      direction: dir,
      rtcpFb: [] as any[],
    };
    const params = Object.entries(c.parameters ?? {}).map(([k, v]) => `${k}=${v}`).join(";");
    if (params) m.fmtp.push({ payload: c.payloadType, config: params });
    if (l.kind === "video") {
      m.rtcpFb.push({ payload: c.payloadType, type: "nack" });
      m.rtcpFb.push({ payload: c.payloadType, type: "nack", subtype: "pli" });
      m.rtcpFb.push({ payload: c.payloadType, type: "ccm", subtype: "fir" });
      if (l.content) m.content = l.content; // RFC 4796 a=content:slides
    }
    if (l.ssrc) m.ssrcs = [{ id: l.ssrc, attribute: "cname", value: `qsvc-${sessionName}` }];
    if (l.srtp) {
      m.crypto = [{ id: i + 1, suite: l.srtp.cryptoSuite, config: `inline:${l.srtp.keyBase64}` }];
    }
    return m;
  });

  return sdpTransform.write({
    version: 0,
    origin: { username: "qsvc", sessionId: now, sessionVersion: 1, netType: "IN", ipVer: 4, address: ip },
    name: sessionName,
    timing: { start: 0, stop: 0 },
    connection: { version: 4, ip },
    media,
  } as any);
}

export interface AnswerMLine {
  kind: "audio" | "video";
  ip: string;
  port: number;
  rtcpPort: number;
  payloadType: number;
  codecName: string;
  ssrc?: number;
  srtp?: ms.SrtpParameters;
  protocol: string;
  cryptoTag?: number;
  hasCrypto: boolean;
  rejected: boolean;
}

/** Parses FreeSWITCH's answer: where to send, what PT/SSRC it will send, its SDES key. */
export function parseAnswer(sdp: string): AnswerMLine[] {
  const s = sdpTransform.parse(sdp);
  return (s.media ?? []).map((m: any) => {
    const ip = m.connection?.ip ?? s.connection?.ip;
    const pt = Number(String(m.payloads).split(" ")[0]);
    const rtp = (m.rtp ?? []).find((r: any) => r.payload === pt);
    const crypto = m.crypto?.length === 1 && !m.crypto[0].sessionConfig ? m.crypto[0] : undefined;
    const inlineKey = typeof crypto?.config === "string" ? /^inline:([A-Za-z0-9+/]+={0,2})$/.exec(crypto.config)?.[1] : undefined;
    return {
      kind: m.type,
      ip,
      port: m.port,
      rtcpPort: m.rtcp?.port ?? m.port + 1,
      payloadType: pt,
      codecName: rtp?.codec ?? "",
      protocol: m.protocol,
      cryptoTag: crypto?.id,
      hasCrypto: Boolean(m.crypto?.length),
      ssrc: m.ssrcs?.[0]?.id ? Number(m.ssrcs[0].id) : undefined,
      srtp: inlineKey
        ? { cryptoSuite: crypto.suite as ms.SrtpCryptoSuite, keyBase64: inlineKey }
        : undefined,
      rejected: m.port === 0,
    };
  });
}

/** Validate every active line before connecting any transport. */
export function validateAnswer(lines: MLineSpec[], answer: AnswerMLine[]): void {
  if (lines.length !== answer.length) throw new Error("MCU changed the number of media lines");
  lines.forEach((line, index) => {
    const remote = answer[index];
    if (remote.rejected || remote.kind !== line.kind) throw new Error(`MCU rejected or reordered ${line.kind} media`);
    if (!line.srtp) {
      if (remote.protocol !== "RTP/AVP" || remote.hasCrypto) throw new Error("MCU changed plain media profile");
      return;
    }
    if (remote.protocol !== "RTP/SAVP" || remote.cryptoTag !== index + 1 || remote.srtp?.cryptoSuite !== line.srtp.cryptoSuite) {
      throw new Error(`MCU did not accept the offered SRTP suite on ${line.kind}`);
    }
    const key = Buffer.from(remote.srtp.keyBase64, "base64");
    const expectedLength = Buffer.from(line.srtp.keyBase64, "base64").length;
    if (key.length !== expectedLength || key.toString("base64") !== remote.srtp.keyBase64) {
      throw new Error(`MCU returned invalid SRTP keying material on ${line.kind}`);
    }
  });
}
