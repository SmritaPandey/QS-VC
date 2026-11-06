# QS-VC implementation alignment

Reviewed 6 November 2026. Domain: qsvcmeet.com. Proposed deployment region:
AWS Mumbai. Budget: $100/month. This is an implementation brief and source
assessment, not proof of deployed features, security certification or capacity.

## Source of truth

The team read all 21 repository Markdown files in the review inventory:
README.md, PRODUCT.md, PROJECT_AUDIT.md, DEMO_CHECKLIST.md,
services/recording/README.md, all 14 architecture documents, and both docs manuals.
Architecture and manual examples describe intended capabilities; source/tests and
runtime evidence determine implementation status. PROJECT_AUDIT.md is historical;
its previous build/permission failures have since received fixes. Do not restore
old defects or treat the manual's capability claims as runtime evidence.

Latest user decisions override older documents:

- Whisper and Google Translate are now allowed (2 November 2026).
- Preserve approved navy/teal/Plex meeting interface and repository boundaries.
- Listeners independently choose caption and listening languages.
- Recording is required for the demo: private stored recordings with authorized
  playback/download/delete. Current recording disablement is temporary safety
  behavior, not the target product. Do not reopen old unauthenticated routes.
- Hostinger domain is qsvcmeet.com. AWS service access does not provide Google
  Cloud Translation credentials or make Google processing occur in Mumbai.

## Required participant experience

A speaks Hindi; B selects English; C selects Hindi. B receives English captions
and, when explicitly enabled, English synthesized audio. C hears original Hindi.
Each participant can separately choose their speaking language, caption language,
hear-in language, and original/translated audio. Changing B's preference must not
change the language for A or C. Translation must not recapture its own TTS output.

The control must show enabling, active, unavailable, denied and interrupted states.
No language is advertised as voice-capable unless STT, translation and TTS actually
support the selected pair. A missing voice permits clearly labelled captions-only.
Use ordinary original audio as recoverable fallback; never label untranslated
source text or the wrong voice as translated output. Show processing disclosure.
Pause transcription on microphone mute, leave, revoked session or explicit disable.

## What is currently implemented

| Area | Source assessment | Required work |
|---|---|---|
| Media/control | SFU/signaling and guest chat exist; permissions were hardened | Physical two-device verification and deployment networking |
| Language choice | Active meeting saves a speaking-language preference | Separate listener/caption choices and capability discovery |
| Speech recognition | Opt-in browser recognition connected; mute/disable/playback stop guards | Acoustic/browser evaluation; selected mic limitation; Whisper remains separate |
| Translation | Room-bound configured LibreTranslate RPCs connected; Google adapter uncalled | Configure real models/server, validate actual pairs and measure latency |
| Translated speech | Device voices connected with matching-language checks and original audio ducking | Actual device playback/autoplay/echo/quality evaluation |
| Captions | CaptionOverlay connected to final room notifications; stable IDs and per-listener language | Real two-device speech and complete rendered/accessibility evaluation |
| PQC | Bundled ML-KEM-1024 and ML-DSA-87 implementations with SP 800-108 Rev. 1 Counter/HMAC-SHA-256 KDF; no classical fallback | Independent implementation review, validation vectors/interoperability, and suitable validated crypto module |
| Participant E2EE | Optional host-required browser sender/receiver transforms, fail-closed, custom frame format, key rotation and replay checks | Independent protocol review, authenticated peer-key verification, supported-browser/two-device testing, and FIPS 140 validation if making that claim |
| Stored recordings | Currently disabled safely | Auth/ownership, upload/commit states, private S3 and DB metadata, library/delete/retention |
| MCU | State/control scaffold | Actual media mixing/gateway engine and independently verified interoperability |

## Processing and security boundary

Whisper can be self-hosted within our system; Google Cloud Translation is a
separate processor receiving transcript text. Explain that boundary to participants.
Whisper transcription is not a universal multilingual speech-to-speech engine:
recognition produces source text; Google translates target text; TTS produces audio.
Use task=transcribe for the source transcript. No voice cloning requirement is
implied. Synthetic voices are sufficient for the first demo.

Choose explicit modes in implementation:

1. Assisted mode: permitted speech/text processing by named services. WebRTC
   transport protection is distinct from participant-only E2EE. A trusted AI
   recipient must be included in the threat model if group encryption is enabled.
2. Private mode: content only available to authorized endpoints. Disable incompatible
   server AI/recording unless an explicitly authorized recipient is added. Endpoint
   inference feasibility is not yet measured.

PQC does not itself provide captions, anonymization, permissions or protection from
an authorized recipient. The browser mode now has an active transform path and no
classical fallback. Its custom frame protocol is not RFC 9605 SFrame. Key identities
are distributed by signaling and self-signatures do not independently bind them to
the displayed people. Tests cover key exchange, envelope integrity, meeting binding,
same-epoch rekey invalidation and SP 800-108 KDF formatting, but not a full browser
media session. NIST algorithm names are not a claim of NIST product compliance or
FIPS 140 validation. Do not use a green badge or `nistCompliant` as verification
evidence. The mode is a limited preview until an independent cryptographic review,
identity-verification design and physical two-device validation are complete.

NIST SP 800-227 recommends that KEM use rely on an approved implementation in a
validated cryptographic module, protect the key-establishment channel, establish
ownership of static encapsulation keys, destroy secrets when no longer needed, and
use key confirmation where appropriate. The code uses a context-bound SP 800-108
Rev. 1 Counter/HMAC-SHA-256 derivation and authenticated encryption, but the current
signaling-distributed client keys and unvalidated JavaScript module do not satisfy
the complete deployment/validation expectations. Do not claim full SP 800-227
conformance.

## Build order and dependencies

1. Establish authenticated room ownership and provider boundary. Keep current
   demo first-arrival hosting explicitly limited until scheduled owner verification.
2. Configure an exact Whisper runtime/model. Start Hindi-English only for acoustic
   tests; benchmark CPU memory and delay before choosing paid hardware. Do not
   assume the architecture's GPU fleet or <300ms/400ms targets fit this budget.
3. Add server-side official Google Cloud Translation access. Requires Google Cloud
   project, enabled API/billing, scoped server credentials and quotas. Never embed
   keys in React or call an unofficial free endpoint. Credentials entered securely.
4. Publish room-bound, length/rate-limited transcripts with server-derived speaker
   identity; stable utterance IDs/revisions/finality. Translate once per target
   language per utterance; bound queues/cache/concurrency and discard obsolete work.
5. Integrate listener captions/audio, explicit start and per-listener choice; cancel
   stale requests/queued speech after language switch, stop, leave or interruption.
6. Restore stored recording with authenticated host policy, all-participant notice,
   S3 object storage, DB metadata, upload recovery and authorized library actions.
7. Independently review the optional crypto protocol and add authenticated peer-key
   verification before expanding its release claims. Test simultaneous senders,
   malformed/replayed frames, joins/leaves, epoch rollover, unsupported browser
   refusal and missing-key refusal in actual supported browsers.
8. Verify Hindi→English and English→Hindi on two physical devices. Measure speech-end
   to caption/audio latency; test accents, overlap, silence, names, numbers, mute,
   tab switches, language changes, reconnect and provider outage. No untested
   all-language, India-only, ISO/FIPS or large-capacity claims.

## Initial safety work and later connector integration

The dormant TranslationEngine now uses only its configured endpoint. Removed
silent MyMemory fallback and obsolete Google-fallback option; failures reject
instead of returning source text as translated speech. Responses are validated;
timeouts are cleaned up; cache distinguishes case and locale. Cross-language
confidence constants removed; the unused panel does not show a confidence meter
without a confidence value. Browser provider-key scaffolding removed. A server-only
official Google adapter is prepared for Hindi-English, with mocked provider tests;
it remains unexposed until authorization, disclosure and usage controls are integrated.
Four actual-engine regression tests passed. Web build
passed with its existing bundle-size warning. That initial patch did not activate translation. The subsequent connector integration
connects browser recognition, room captions, configured LibreTranslate and browser
voices; see EXISTING_LANGUAGE_CONNECTORS.md for setup and remaining evidence.
Whisper/Google are not called by that meeting flow.

No provider inference, physical speech evaluation, cloud deployment, model download,
account/billing changes or cryptographic validation performed in this review.

## Primary references

- https://github.com/openai/whisper
- https://github.com/SYSTRAN/faster-whisper
- https://docs.cloud.google.com/translate/docs/authentication
- https://docs.cloud.google.com/translate/docs/setup
- https://csrc.nist.gov/pubs/fips/203/final
- https://csrc.nist.gov/pubs/fips/204/final
- https://csrc.nist.gov/pubs/sp/800/227/final
- https://csrc.nist.gov/pubs/ir/8547/final
