import { describe, expect, it } from "vitest";
import { buildOffer, parseAnswer, validateAnswer, type MLineSpec } from "../src/sdp";

const line: MLineSpec = {
  kind: "audio",
  port: 20000,
  rtcpPort: 20001,
  codec: { mimeType: "audio/opus", payloadType: 111, clockRate: 48000, channels: 2 },
  srtp: { cryptoSuite: "AEAD_AES_256_GCM", keyBase64: Buffer.alloc(44, 1).toString("base64") },
};
const offer = buildOffer("127.0.0.1", "test", [line], "sendonly");

describe("bridge SRTP answer policy", () => {
  it("accepts the selected AES-256 SDES suite and key size", () => {
    expect(() => validateAnswer([line], parseAnswer(offer))).not.toThrow();
  });

  it("preserves the AES-128 compatibility option", () => {
    const compatible: MLineSpec = {
      ...line,
      srtp: { cryptoSuite: "AES_CM_128_HMAC_SHA1_80", keyBase64: Buffer.alloc(30, 2).toString("base64") },
    };
    const sdp = buildOffer("127.0.0.1", "test", [compatible], "recvonly");
    expect(() => validateAnswer([compatible], parseAnswer(sdp))).not.toThrow();
  });

  it.each([
    offer.replace("RTP/SAVP", "RTP/AVP"),
    offer.replace("AEAD_AES_256_GCM", "AES_CM_128_HMAC_SHA1_80"),
    offer.replace("crypto:1", "crypto:2"),
    offer.replace(/a=crypto:[^\r\n]+\r\n/, ""),
    offer.replace(line.srtp!.keyBase64, Buffer.alloc(30).toString("base64")),
    offer.replace(line.srtp!.keyBase64, `${line.srtp!.keyBase64}|2^20`),
    offer.replace(line.srtp!.keyBase64, `${line.srtp!.keyBase64} UNENCRYPTED_SRTP`),
  ])("rejects a lowered profile, mismatched suite/tag or unacceptable key parameters", (sdp) => {
    expect(() => validateAnswer([line], parseAnswer(sdp))).toThrow(/SRTP/);
  });

  it("requires every offered media line", () => {
    expect(() => validateAnswer([line, { ...line, kind: "video" }], parseAnswer(offer))).toThrow(/number of media lines/);
  });

  it("validates the second media line's unique offer tag", () => {
    const lines: MLineSpec[] = [line, { ...line, kind: "video", codec: { mimeType: "video/VP8", payloadType: 96, clockRate: 90000 } }];
    const sdp = buildOffer("127.0.0.1", "test", lines, "recvonly");
    expect(() => validateAnswer(lines, parseAnswer(sdp))).not.toThrow();
    expect(() => validateAnswer(lines, parseAnswer(sdp.replace("crypto:2", "crypto:1")))).toThrow(/SRTP.*video/);
  });

  it("accepts plain RTP only for the explicit lab offer", () => {
    const plain = { ...line, srtp: undefined };
    expect(() => validateAnswer([plain], parseAnswer(buildOffer("127.0.0.1", "lab", [plain], "sendonly")))).not.toThrow();
    expect(() => validateAnswer([plain], parseAnswer(offer))).toThrow(/plain media profile/);
  });
});
