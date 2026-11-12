# Transcription consent and encrypted meetings

Implemented locally on 12 November 2026. Deployment and real multi-participant meeting acceptance remain pending.

Meeting audio, video and screen sharing retain their existing end-to-end encryption.
A speaker who enables server transcription separately authorizes a microphone
audio copy to signaling and the configured ASR processor. Neither service receives
the meeting media keys through this flow. Signaling can read shared caption text,
translation inputs and transcript content. The encryption details and caption
settings disclose these boundaries.

## Permission and lifecycle

- The processor permission defaults off and is held in component memory.
- A connection or encryption-state transition clears permission and speech sharing.
- The speaker first permits processor access, then separately enables speech sharing.
- The ASR start request must contain processorConsent=true. The server rejects
  requests that omit or deny consent, including direct RPC clients.
- Server plan, webinar and room membership controls still apply.
- Mute and translated playback pause recognition through the existing lifecycle.
- Revocation stops the local capture clone and asks the server to terminate ASR.
  The server drops subsequent chunks and pending results once the stop arrives.
  Previously delivered captions cannot be recalled.
- Participants receive processor state updates. Capability responses include the
  current state so a late joiner can display the same notice.
- An ASR error stops sharing. The implementation does not automatically send
  audio to a different recognition provider after that error.

The consent flag records the client's authorization assertion. It cannot prove
a physical checkbox interaction. Enforcing the trusted first-party UI and
protecting the signaling session remain necessary.

## Verification

The regression suite passed 704 tests. The consent test rejects missing consent,
preserves the encrypted room setting, verifies processor participant state, and
rejects audio/results after revocation. Web and signaling builds passed.

A temporary Chrome harness at 390 and 1440 CSS pixels verified disabled sharing
before consent, a separate sharing action, revocation, reconnection reset and
processor notices. It used simulated ASR capabilities and capture, with no actual
microphone transmission. No horizontal overflow or browser runtime errors were
observed. Real encrypted meeting audio, acoustic recognition, transcript retention
and deployed release compatibility still require acceptance testing.

Deploy the updated web client and signaling service together. Older clients
without the processorConsent field will be rejected by the updated ASR start API.
Processor TLS/private networking and ASR storage behavior require deployment review.
