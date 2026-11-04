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

const SUITE_MAP: Record<string, string> = {
  AES_CM_128_HMAC_SHA1_80: "AES_CM_128_HMAC_SHA1_80",
  AES_CM_128_HMAC_SHA1_32: "AES_CM_128_HMAC_SHA1_32",
};

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
      m.crypto = [{ id: i + 1, suite: SUITE_MAP[l.srtp.cryptoSuite] ?? l.srtp.cryptoSuite, config: `inline:${l.srtp.keyBase64}` }];
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
  rejected: boolean;
}

/** Parses FreeSWITCH's answer: where to send, what PT/SSRC it will send, its SDES key. */
export function parseAnswer(sdp: string): AnswerMLine[] {
  const s = sdpTransform.parse(sdp);
  return (s.media ?? []).map((m: any) => {
    const ip = m.connection?.ip ?? s.connection?.ip;
    const pt = Number(String(m.payloads).split(" ")[0]);
    const rtp = (m.rtp ?? []).find((r: any) => r.payload === pt);
    const crypto = (m.crypto ?? [])[0];
    return {
      kind: m.type,
      ip,
      port: m.port,
      rtcpPort: m.rtcp?.port ?? m.port + 1,
      payloadType: pt,
      codecName: rtp?.codec ?? "",
      ssrc: m.ssrcs?.[0]?.id ? Number(m.ssrcs[0].id) : undefined,
      srtp: crypto
        ? { cryptoSuite: crypto.suite as ms.SrtpCryptoSuite, keyBase64: String(crypto.config).replace(/^inline:/, "").split("|")[0] }
        : undefined,
      rejected: m.port === 0,
    };
  });
}
