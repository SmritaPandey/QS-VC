# QSVC implementation and security roadmap

4 November 2026 · Source assessment, local repair candidate and proposed operating plan

## Decision

Keep the existing mediasoup conferencing stack. Repair account-state semantics first, make one supported internet and one supported intranet deployment reproducible, then replace the browser-dependent speech demo with a configured Whisper → official Google Cloud Translation → optional Japanese speech pipeline. Do not migrate to Jitsi merely to obtain translation or claim ISO compliance.

The current repository was read at `/Users/shwetakushwaha/Downloads/QS-VC-private`, HEAD `a8514e876f97f86e212a0d62010860738a393cd7`. Its working tree was clean at inspection. The previous 3 November review described an older revision and was used as a lead, not current evidence. The referenced chat was retrieved; it contains the original request, with no attached implementation or additional repository evidence.

**Implementation update, 4 November 2026.** The combined account and intranet patch is applied to this working tree. It includes shared session state, enterprise access and installer guards, distinct 401/403/503 responses, corrected local service routing, and concurrent SFU room creation. The AWS Compose profile now binds SFU control HTTP to loopback while leaving its separate WebRTC media listeners intact. The existing LibreTranslate configuration is passed into signaling.

**Translation update.** Signaling now supports explicitly configured Google Cloud Translation for English, Hindi and Japanese. A speaker must separately allow Google processing of shared caption text. The existing listener controls use translated text for captions and matching device voices. Browser recognition remains the speech input. See [language configuration](EXISTING_LANGUAGE_CONNECTORS.md) for setup and limitations.

**Local evidence.** 313 tests passed outside the recording suite. All nine recording HTTP tests passed separately with permission to start the local test server. Signaling and web builds passed. Lint requires ESLint. Real-account, browser, LAN/WAN media, deployment, and language quality checks remain release gates.

Evidence terms: **Source** means executable code/configuration inspected; **Local** means an executed local check; **Proposal** means a target or design, not an existing capability; **Unknown** requires runtime, account, network, assessor or physical-device evidence. This is a risk-focused end-to-end flow review, not a claim that every line/history/dependency or every installed environment has been audited.

## 1. What exists and where data goes

**Source topology:** browser/Electron web client → public static site/Cloudflare Worker → Caddy/API services → PostgreSQL; browser → signaling WebSocket → mediasoup control API; browser media → SFU directly or through coturn. Recording is composed in the host’s browser, uploaded through the recording service to private S3, and accessed through authorized short-lived URLs. Cloudflare HTTP proxying does not carry the UDP media stream.

| Surface | Source owner | Verified source behavior / boundary |
|---|---|---|
| Auth | `services/auth/src/index.ts`, `sessions.ts` | JWT plus DB-backed session ID in user preferences; one active session/account; tenant/account active checks; server logout |
| Navigation | `frontend/web/src/lib/session.ts`, `SiteNav.tsx`, `Landing.tsx`, `Login.tsx`, `SignedInWorkspace.tsx` | Tab-scoped bearer token; separate component state caused inconsistent account presentation |
| Meeting API | `services/meeting/src/index.ts`, `meeting-range.ts` | Tenant-scoped API; verifies sessions through auth service; its outage classification also caused false logout |
| Membership/policy | `services/signaling/src/ws-attach.ts`, `meeting-policy.ts`, `rpc/` | Guest/signed-in membership, room policy, host actions; auth checked before signed-in RPC; room state in process memory |
| Media | `services/sfu/src/index.ts`, `config.ts`, `frontend/web/src/lib/media.ts` | mediasoup transport/producer/consumer path; network/security/scale must be measured |
| Captions | `MeetingCaptions.tsx`, `speech-to-text.ts`, signaling `captions.ts` | Browser recognition sends final text; room membership checked; bounded caption and translation caches; LibreTranslate capabilities queried |
| Speech output | `MeetingCaptions.tsx`, `realtime-translation.ts` | Listener device SpeechSynthesis voices; independent caption and heard-language choices; unsupported voice disables selection |
| Google adapter | signaling `translation.ts` | Official server-only v2 adapter exists, allows English/Hindi only; not called by active caption path; Japanese requires explicit implementation |
| Recording | recording `app.ts`, `storage.ts`, client recording helpers | Private S3 adapter; demo size cap; host browser must survive capture/upload; failed in-memory copy can be lost on closure |
| Public internet | `deploy/aws/*`, `deploy/cloudflare/*` | AWS host-network services/Caddy/coturn, private DB config, narrow media ranges; live state unknown |
| Other deployment paths | `docker-compose*.yml`, `start-*.js`, desktop | Older launch/config paths disagree with active services; not interchangeable production runbooks |
| E2EE | client `e2ee.ts`, scheduling and policy | Helper exists; active media hookup not established. Server refuses meetings requiring unverifiable E2EE. No post-quantum assurance established |
| Assistant | `AIChatBot.tsx`, `public-help-replies.ts` | Local control-help replies; not evidence of deployed LLM inference |

README architecture claims (Redis/MinIO/quantum-safe enterprise capabilities) must be checked against executable paths. Redis references are not shared room coordination. MinIO variables are not enough to configure the current S3 adapter. SSO/payment buttons and MCU/SIP feature descriptions are not proof of working integration.

The [security baseline](QSVC_SECURITY_BASELINE.md) gives concrete findings and six-category audit coverage for the original revision. Implementation priority below is not a CVSS score.

## 2. Fix order and exact acceptance

| ID / priority | Failure and source | Smallest complete action | Required proof |
|---|---|---|---|
| AUTH-01 P0 | `/api/auth/me` catches DB failure as401 (`auth/src/index.ts`) | Existing session-error classification: invalid/expired/revoked401; dependency failure503 | Handler test for DB outage, invalid JWT/session, valid profile without internal session ID |
| AUTH-02 P0 | Meeting auth middleware maps auth503/timeout to401 (`meeting/src/index.ts`) | Preserve auth401; map upstream unavailable/throttled/malformed response/network failure to503 | Middleware tests must prove no tenant callback on failure and correct tenant on success |
| AUTH-03 P0 | Public nav defaults Sign in; launcher snapshots token (`SiteNav`, `Landing`) | Shared reactive account state: anonymous/checking/authenticated/unavailable; revalidate on focus/restoration; update from one credential owner | Login → website → app → Back/Forward stays consistent; outage retains credential without claiming verified identity |
| AUTH-04 P0 | Login deletes current token before success (`Login`) | Replace credential only after successful login; use same shared owner for signup | Incorrect password/network failure preserves prior credential |
| AUTH-05 P0 | Late401/logout/WS close can clear newer login | Bind async result to captured token/generation; guarded invalidation; ignore stale responses | A delayed response for A cannot delete B; old logout revocation cannot clear current credential |
| DEP-01 P0 | Intranet launcher omits required services, MCU/auth port conflict | Use explicit LAN manifest with auth4002, meeting4003, recording4004, signaling4001, SFU4000 and distinct MCU if actually supported | Fresh machine boot, readiness, auth, two-device media; never equate open TCP port with service readiness |
| DEP-02 P1 | Older production Compose network/storage mismatch | Select one documented topology; correct SFU routing and configure current S3-compatible adapter intentionally | Compose validation, container DNS/control connectivity, upload/play/delete smoke test |
| MEDIA-01 P1 | SFU per-IP quota aggregates signaling control requests | Separate authenticated internal control quota from public ingress, with bounded per-room/tenant limits | Ten-person audio/video setup and churn stays below intended quotas; abusive requests bounded |
| MEDIA-02 P1 | Concurrent first room setup can create competing SFU routers | In-flight room creation keyed by room ID; cleanup on failure/close | Concurrent creation returns one router; rejection permits retry; no orphan resources |
| LANG-01 P1 | Active LibreTranslate not injected in AWS signaling environment | Explicit configuration for retained demo; for production implement approved provider selection, no hidden fallback | Running capabilities and Hindi/Japanese pair check; missing config yields unavailable |
| SEC-01 P1 | Static TURN credentials; bearer in WS URL | Time-limited TURN credentials; single-use WS ticket or carefully designed cookie/first-message auth; scrub token query logs immediately | Expiry/replay/relay-abuse tests; proxy/app logs contain no bearer value |
| SEC-02 P1 | Security assertions outpace active implementation | Correct README/installer/schedule/product claims with product owner; separate transport crypto, E2EE and PQC | Claims inventory tied to integration and review evidence |
| QA-01 P1 | Render tests crash on server `window` access; lint permitted to fail | ThemeSelect SSR fallback; working lint setup; explicit Worker test gate | Relevant suites/build green; release CI cannot silently ignore checks |
| SCALE-01 P2 | Process-local room/caption state and per-RPC auth dependency | Measure first; room affinity plus shared control/revocation design before replicas | Restart/reconnect/load tests; measured dependency failure behavior and bounded queues |

The implementation update at the top records the fixes applied in this checkout. The acceptance checks below still govern release.

## 3. Session and navigation contract

One shared session owner above or outside routes must drive the public account link, launcher and protected-page guards. Token presence means only “credential to check.” Check `/me` with a timeout; show “Checking account…” until validated. On network/503, keep the credential, show retry/unavailable, and let server authorization decide every privileged operation. A503 is not a guest transition. Only confirmed401 or the server’s confirmed invalid-session WS close4003 clears the matching credential.

Use generation/token guards for every async check, profile/meeting request, login and logout. Abort obsolete requests and also check identity before applying results, because cancellation alone does not prevent already-resolved promises. A response after component unmount must not update UI or erase a replacement session. Serialize/check duplicate login submissions and ignore obsolete checks. Never publish bearer credentials to BroadcastChannel or logs.

Keep the current tab-scoped sessionStorage policy explicit. Token-free cross-tab messages can request revalidation; a different tab may contain a newer/different valid session and must not be blindly cleared. A newly opened tab is not guaranteed signed in. If product requirements demand shared durable sign-in, separately migrate to Secure/HttpOnly/SameSite cookies with CSRF defenses and a documented refresh/revocation design; do not quietly add persistent localStorage bearer tokens.

Successful server logout or already-invalid401 clears the matching local session and protected view data. Network/503 logout failure stays retryable and must not claim revocation. “Forget this browser” would be a separate local-only action if needed. Closing/leaving a meeting ends its owned tracks/caption/playback lifecycle, not the account. On actual session expiry, stop privileged requests and ensure a meeting cannot silently continue as a newly privileged guest. Backend permission checks remain authoritative.

Current one-session-per-account policy means a second device login intentionally invalidates the first. To support simultaneous phone/laptop, introduce a dedicated sessions table (id, user, tenant, issued/expiry/revoked times, device metadata), indexed lookup, this-device/all-devices logout and bounded refresh-token rotation/reuse handling. This is a product/database change, not a navigation bug fix.

## 4. Hindi → Japanese implementation specification

### Current demo versus target

The current speaker opts into browser recognition. Final captions go through room RPC, LibreTranslate handles text and listener device voices speak output. This already separates caption and voice enablement, but recognition may use a different microphone from the selected meeting device and may send audio to a browser vendor. Hindi/Japanese availability is not established merely because the selectors show those languages.

PRODUCT.md records approval for configured Whisper and the official Google Cloud Translation API. Use that as the production target. Keep the browser/LibreTranslate demonstration visibly separate. No provider fallback without configuration and disclosure. A fully disconnected intranet cannot call Google; it needs an explicit offline profile with locally validated translation models and a recorded product decision about the different provider/quality boundary.

### Proposed data path

1. A chooses `speakingLanguage=hi-IN`, selects the microphone and explicitly enables speech processing. Capture a clone of the selected outbound microphone track, not mixed meeting playback. Muting/stopping/replacing the source must update the recognizer immediately.
2. Send authorized, sequence-numbered bounded audio chunks to a dedicated speech worker. Bind tenant, room, peer and session from server membership, never from trusted client identity fields. Keep SFU and CPU/GPU inference isolated. Alternatively implement a documented SFU consumer per opted-in speaker; this is more operational work but avoids browser-ASR device mismatch.
3. Whisper/faster-whisper performs Hindi transcription (`task=transcribe`, language Hindi). Whisper’s translation task targets English; it is not a Hindi→Japanese voice translator. Implement VAD, bounded overlap, incremental stabilization and deduplication around the model; chunked inference is not inherently a production streaming protocol.
4. Emit an immutable final segment: `segmentId, sequence, tenantId, roomId, peerId, sourceLanguage, sourceText, startMs, endMs, revision, final=true`. Derive identity server-side. Use interim captions only for local preview; synthesize finalized text only.
5. For each distinct requested target, call the official Google NMT adapter with normalized language (`hi`→`ja`). Extend the current allowlist and wire the adapter into the active caption path rather than leaving a second unused pipeline. Record configured provider/model/region in capabilities. Cache/deduplicate only within tenant+room+segment+target+model revision. Shared listeners should reuse one result, not bill once each.
6. B independently selects captions Japanese, spoken Japanese, both or neither. Captions-only performs translation without TTS. Voice-only avoids displaying a caption but still uses the same authorized final segment. Neither starts no listener output work; A’s sharing consent remains a separate control.
7. For voice, prefer an installed Japanese voice for the no-API-cost pilot if explicitly supported; use configured Google `ja-JP-Standard-*` as the inexpensive predictable cloud option when enabled. Server TTS credentials stay server-side. Bound text/output size; select plain text or sanitize SSML. Use short-lived authorized audio access, cancellation and no default durable audio storage.
8. Playback follows segment order. Duck original remote audio only while translated speech actually plays, then restore it in every success/error/cancel path. Exclude own speech. Use bounded queues and skip stale segments with a visible status. Do not concatenate overlapping speakers into invented dialogue; identify speaker and state when translations cannot keep up.
9. On mute, leave, reconnect generation change, session invalidation, consent-off or language change, cancel the appropriate capture/request/queue/playback. A stopped old queue must never play in a later room. Keep headphones guidance, user gesture/autoplay recovery and original-audio fallback.

Google documents Hindi/Japanese support and Japanese Standard voices; that establishes provider capabilities, not QSVC integration or language accuracy. [Cloud Translation languages](https://docs.cloud.google.com/translate/docs/languages), [TTS voices](https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types). Whisper and faster-whisper are self-hostable; benchmark the chosen model/hardware and retain licensing/provenance. [Whisper](https://github.com/openai/whisper), [faster-whisper](https://github.com/SYSTRAN/faster-whisper).

### API and resource boundaries

Propose membership-authorized `speech.start`, `speech.chunk`, `speech.stop`, `listener.preferences` and existing caption/translate operations, with explicit schemas and error codes. Prefer extending established room RPC owners. Limit concurrent streams per tenant, audio chunk duration/size, segment length, pending requests, output rate, daily spend and room lifetime. Add request IDs and stage timings without transcript text in ordinary logs. Provider keys are never `VITE_*` values. Reject arbitrary upstream URLs from participants; provider endpoints are administrator configuration with egress controls.

Existing caption quotas (500ms publish spacing, 30 translations/minute/client, room/global concurrency and bounded caches) are useful but must match segmentation. One final sentence every second exceeds30 translations/minute; tune based on measured sentence cadence and abuse budget. Avoid solving this by removing limits. Provider failure should preserve original captions labeled correctly and original audio, not report untranslated text as translated.

### Proposed release tests and quality gates

Use bilingual human review, not only mocks or similarity scores. A consented Hindi corpus should include names, dates, money, negation, accents, background noise, Hindi/English code switching and simultaneous speakers. Confirm Japanese retains meaning and speaker identity. Include a reverse-language sample and a language not installed/supported. Save redacted fixtures and scoring rubric.

Proposed initial targets, to negotiate after hardware/provider benchmarks: p95 finalized-caption delay ≤3s after segment end; p95 speech start ≤5s; no duplicate finalized segments, cross-room output or post-leave playback; stale queued speech bounded to6s; no silent unbounded retries. These are targets, not measured results. Record capture/VAD/ASR/MT/TTS/delivery/playback latencies separately so a slow stage is diagnosable.

Run caption-only/voice-only/both/neither, unsupported microphone/voice/provider, mute/unmute, language switch, speaker overlap, timeout429/503, reconnect, logout, host removal, room reuse and tenant-isolation tests. Two real devices and acoustic playback are required; injected text cannot prove microphone routing or speech quality.

## 5. Cost model and practical low-cost choices

Prices researched on 4 November 2026, USD before taxes, exchange rates and hosting. Usage assumptions are illustrative: 700 billable source characters per processed audio minute, one distinct target, one ASR stream, and 350 Japanese output characters per minute when voice is enabled. Actual scripts/speech rates/output lengths vary; meter Unicode characters according to each provider rather than estimating from bytes or English words. A meeting minute with multiple simultaneous streams is multiple processed stream minutes.

| Component | No recurring API bill route | Managed comparison / assumptions |
|---|---|---|
| Recognition | Self-host Whisper/faster-whisper on existing suitable hardware; compute/power/operations still cost money | Deepgram direct Nova-3 multilingual streaming currently lists$0.0092/processed minute. Alternate paid service, not an automatic approved-provider substitution |
| Translation | Self-host LibreTranslate/Argos with tested Hindi/Japanese models and direct/pivot pair capabilities; do not assume installed coverage or equivalent quality | Google default NMT$20/million source characters per target, up to$10 monthly credit shared across eligible Basic/Advanced usage |
| Voice | Installed device Japanese voice if available, permitted and verified offline | Google Standard$4/million characters after eligible4 million monthly free characters; named Japanese Standard voices exist |
| Delivery | Existing LAN capacity / owned server | Media/TURN/API egress, public IP, recording storage and monitoring remain separate |

Sources: [Deepgram pricing](https://deepgram.com/pricing), [Google Translation pricing](https://cloud.google.com/products/translate/pricing), [Google TTS pricing](https://cloud.google.com/text-to-speech/pricing), [LibreTranslate source/license](https://github.com/LibreTranslate/LibreTranslate). Free allowances require billing/eligibility review and can already be consumed elsewhere. Deepgram search results showed promotional/transport-dependent alternatives; use the direct current rate above as a conservative comparison, and verify the contracted endpoint/model before buying. Do not infer a universal lowest price from this shortlist.

| Example | 1,000 processed min | 10,000 processed min |
|---|---:|---:|
| Google NMT gross:700chars/min×$20/M | $14 | $140 |
| Google NMT after unused eligible$10 credit | $4 | $130 |
| Japanese Standard TTS gross:350chars/min×$4/M | $1.40 | $14 |
| TTS after unused eligible4M character allowance | $0 | $0 |
| Self-host Whisper + Google NMT + device voice | $4 + compute | $130 + compute |
| Self-host Whisper + Google NMT + Standard TTS with stated unused allowances | $4 + compute | $130 + compute |
| Deepgram comparison + Google NMT + device voice, excluding Deepgram signup credit | $13.20 | $222 |
| Fully local ASR/MT/TTS | $0 variable API fee + hardware/power/operations | Same formula, capacity dependent |

Gross cloud-voice totals without credits are$15.40 and$154 for MT+TTS, plus recognition. If twice as many target languages are requested, MT work approximately doubles, while ASR need not. TTS cost uses actual synthesized characters and voice choices; cache sharing applies only when content/language/voice/settings match and room authorization permits reuse. Do not synthesize captions that nobody requested to hear.

Budget formula:

`ASR processed minutes × ASR rate + MT source characters × distinct targets × MT rate + TTS output characters × voice rate + inference hosting + media/TURN egress + recording/storage + observability + engineering`.

A hypothetical$60/month inference worker replaces$0.0092/min paid recognition at about6,522minutes/month before power/operations/capacity/quality differences;$60 is an assumption, not an AWS quote. Do not place inference on the existing small media host without headroom testing. On idle owned hardware, self-host recognition plus Google’s available translation credit is a reasonable cheapest-cash pilot within the approved provider target. Fully local can minimize recurring API spend but demands separate model coverage and operations.

A1 Mbps outgoing stream is approximately0.45 GB/hour before protocol overhead. SFU outgoing participant-stream hours and relay ratio can dominate translation cost. Obtain actual EC2/EBS/IPv4/RDS/S3/Cloudflare/TURN usage and regional prices before claiming a minimum production monthly bill. AWS Translate is another possible MT option, but this run did not retrieve a reliable numeric rate from its rendered price table, so it is not included in the executable budget.

## 6. Internet and intranet deployment requirements

### Public internet

Use the active AWS deployment files as a starting point, not proof of deployed state. Inventory deployed revision/image digest, migration version, restricted DB users, bucket/IAM policy, Cloudflare/Caddy routes, SG/NACL/host firewall and public DNS. Compare runtime environment names to actual service reads without printing values.

Serve static web over HTTPS and signaling over WSS. Allow only configured website origins. Keep auth/meeting/recording/SFU control APIs private; host-network containers share the host boundary. AWS configuration expects SFU40000–40100 TCP/UDP, TURN3478 and TURN relay49152–49200 UDP; verify these against runtime values and packet captures. If adding TURN TLS443 for restrictive networks, plan a dedicated hostname/IP or explicit multiplexing because Caddy HTTPS already owns443. Never assume opening a new firewall rule creates TLS TURN support.

Use expiring TURN credentials and quotas; deny internal/loopback/multicast peer targets where appropriate. Test direct UDP, TCP fallback and forced TURN on two external networks. Verify announced/public IP, NAT and IPv6 policy. Add readiness beyond port-open, alert on auth503/DB latency/SFU worker death/relay errors and bound restart behavior. A single host remains a failure domain; availability requires measured capacity and a designed multi-host/room-placement strategy.

Before migrations: verify database identity, backup/restore, versioned migrations and least-privileged migration account. Use the existing maintenance container rather than assuming Node must be installed on the host. Never automatically run unreviewed production migrations during this assessment. Rollback must cover schema/data, not just frontend files.

### LAN/intranet and disconnected operation

The current `start-intranet.js` is not an adequate enterprise production runbook: MCU defaults to auth’s4002, required services are omitted, and advertised HTTP LAN access does not provide the ordinary trusted HTTPS secure context required for browser capture. Port-open checks cannot distinguish MCU from auth. Replace it with a pinned supported manifest and trusted internal DNS/PKI certificates, correct SANs, managed trust on clients, WSS, internal SFU announced IP and subnet firewall rules. LAN is an untrusted network; keep tenant/role controls, TLS, logging and patching.

Create two explicit modes: connected private deployment (approved outbound provider access through controlled egress) and fully disconnected (all ASR/MT/TTS models, fonts, segmentation assets, package/image dependencies, DNS/NTP and object storage internal). Browser recognition and browser/device voices may contact external providers; test with outbound denied and packet capture. Replace default public STUN/CDN assets for offline mode. Provision models/images before disconnection; document signed offline update and vulnerability-feed import procedures. Google translation cannot operate in an air gap. For internal MinIO, explicitly extend the recording storage adapter with an administrator-configured S3 endpoint/path-style and credential source, or provide a tested local adapter. Test that presigned playback URLs resolve from participant machines; server-local hostnames and merely supplying `MINIO_*` variables are insufficient.

Desktop/Electron needs its own review: context isolation, sandbox/node integration, narrow IPC, approved navigation/URL schemes, permission handlers, TLS trust, signed installers/updates and no embedded production secrets. Do not disable web security or certificate verification to get LAN capture working. Verify Windows installer on a real supported machine; a local macOS web test cannot establish that result.

Recording policy in PRODUCT.md is host-controlled retention until deletion. Preserve that explicit product decision: define and display quotas, deletion and backup-copy behavior; do not silently introduce automatic expiry. Verify deletion from metadata/object/share caches, authorized downloads and five-minute signed-URL residual access. Browser capture is not unattended server recording or a backup.

## 7. Jitsi and InstaVC: patterns to adapt

Jitsi separates React client, Prosody signaling, Jicofo conference coordination, Jitsi Videobridge media routing, Jigasi SIP gateway and Jibri recording. Adapt that separation to QSVC’s existing owners; it does not require replacing mediasoup. [Jitsi architecture](https://jitsi.github.io/handbook/docs/architecture/).

The current Jitsi handbook describes bridge-based transcription: JVB forwards each participant’s Opus audio by WebSocket to a transcription service, Jicofo activates it, and results return to the conference. It deprecates the older Jigasi transcription path. Use this as evidence for per-speaker capture and isolated speech processing, not evidence that QSVC already supports it. [Current transcription guide](https://jitsi.github.io/handbook/docs/devops-guide/transcription/).

Jitsi’s security page distinguishes transport protection and optional E2EE. Neither using WebRTC nor adopting Jitsi certifies an operator’s deployment. Recording/transcription needs access to clear audio at an endpoint or trusted bot; document the trust change for any future E2EE mode. A normal server-side translator cannot process opaque end-to-end encrypted media without an authorized decrypting participant. [Jitsi security](https://jitsi.org/security/).

InstaVC/inMeet publicly advertises cloud/on-premise deployment and encryption. No InstaVC repository was listed in the connected local projects or inspected checkout. No internal architecture, current scoped certificate or independent operational evidence was available in this review. Do not infer its SFU/MCU implementation, key custody, intranet behavior or ISO scope from marketing. Borrow explicit deployment choices and administrator controls only. [InstaVC product source](https://www.instavc.com/products/video-meeting-software).

Before adopting vendor assurances, request certificate legal entity/scope/expiry/accreditation and applicable service location, data-flow/subprocessor list, key-management/E2EE design, retention/deletion terms, recovery tests, VAPT summary/retest and contractual responsibility matrix. Public product claims remain claims until supporting evidence is checked.

## 8. ISO-aligned control and evidence structure

These are implementation/evidence workstreams, not certification or a clause-complete ISO audit. Obtain licensed current texts and an accredited assessor’s scope before formal conformity mapping. Current catalog editions verified:27001:2022 (catalog lists an amendment),27017:2026,27018:2025 and27701:2025. ISO27701 is now an independent PIMS management-system standard. [27001](https://www.iso.org/standard/27001), [27017](https://www.iso.org/standard/27017), [27018](https://www.iso.org/standard/27018), [27701](https://www.iso.org/standard/27701).

| Workstream / owner | Applies to | Required implementation and evidence | Initial verification frequency |
|---|---|---|---|
| ISMS / service owner |27001 | Scope legal entity/service/internet/intranet/support/suppliers; assets, risk method/register, treatment, Statement of Applicability, policies, objectives, internal audit/management review | Monthly risk tracking; audit/review on defined program |
| Cloud responsibilities / platform owner |27017 | AWS/Cloudflare/customer ownership, privileged administration, tenant separation, VM/container/network hardening, secure deletion and monitoring | Per change + quarterly review |
| Cloud PII / privacy owner |27018 | Data-flow and processor contracts; audio/transcript/recording processing purpose, location, retention, subprocessor access, deletion and disclosure handling | Supplier onboarding/change + periodic review |
| PIMS / privacy owner |27701 | Controller/processor roles, privacy risk assessment, lawful-purpose/notice/consent records, rights requests, transfer/incident procedures, privacy metrics | Per feature and scheduled audit |
| Identity / auth owner |Application and ops | Joiner/mover/leaver, MFA for privileged staff, least privilege, service identities, secret rotation, session tests/access review | Monthly access review + release regression |
| Secure engineering / engineering lead |All builds | Threat models, ASVS test matrix, peer review, CI gates, SBOM/dependency/image scans, secret scanning and exception expiry | Every release |
| Operations / SRE |Internet and LAN | Central redacted logs, alert owners, incident drill, patch SLA, time sync, inventory and hardened baselines | Continuous alerts; monthly patch review |
| Continuity / service owner |DB, media, recordings, models | Business impact analysis, agreed RTO/RPO, tested backups/restore, room restart behavior, supplier outage and rollback plans | Proposed quarterly exercises |
| AI quality / language owner |ASR/MT/TTS | Model/provider inventory, licenses/hashes, language evaluations, consent, data handling, limits and change approval | Model/provider change + scheduled samples |

Use evidence folders: `01-scope-assets`, `02-risk-SoA`, `03-identity-secrets`, `04-engineering`, `05-cloud-network`, `06-privacy-suppliers`, `07-operations-incidents`, `08-continuity`, `09-AI-quality`, `10-VAPT-retest`. Every row: control/requirement ID and version, accountable owner, implementation, evidence link/revision/date, test result, exception/risk acceptance and expiry. A vendor certificate covers its stated scope, not QSVC automatically. No current QSVC certificate or operating control history was verified.

Relevant WebRTC baseline: RFC 8826 threat model and RFC 8827 security architecture. Verify HTTPS/WSS origin integrity, permission/capture lifecycle, DTLS-SRTP media, ICE consent/fingerprints, authenticated signaling and membership, private control interfaces, TURN abuse protection and media-resource limits. Transport encryption terminates at the SFU unless a separately integrated E2EE layer protects media payloads. [RFC 8826](https://www.rfc-editor.org/info/rfc8826/), [RFC 8827](https://www.rfc-editor.org/info/rfc8827/). Do not treat a helper filename or AES setting as protocol verification.

## 9. OWASP verification and LLM threats

Use ASVS 5.0.0 Level 2 as the proposed application verification baseline, with risk-selected higher-assurance controls for tenant boundaries/admin/recordings. Pin exact requirement IDs from the adopted release in the assessment workbook; this roadmap is not a statement that ASVS has passed. Supplement with OWASP Top 10:2025, API Top 10:2023 and a pinned WSTG stable version. [ASVS](https://asvs.owasp.org/), [Top10](https://owasp.org/projects/top-ten), [API risks](https://api-security.owasp.org/).

| Risk group | QSVC-specific test |
|---|---|
| Authentication/session | Missing/expired/revoked tokens; second-device invalidation;503 vs401; admin disable; logout replay over HTTP and WS; latest-token races |
| API1/3/5 authorization | TenantA/B meeting IDs, recording IDs, share IDs, role/user fields; property and function authorization; no client-selected host/admin escalation |
| API4/6 resource/business abuse | Room creation, guest join, WS message rate, captions, ASR stream count, translation/TTS queues and spend; shared NAT quota behavior |
| API7 SSRF | Admin-configured provider endpoints, redirect denial, recording fetch/import or any server URL intake; egress isolation and metadata deny rules |
| API8/9 configuration/inventory | Active and legacy endpoints/compose/start scripts; default credentials; exposed control ports; CORS, proxy trust and CSP |
| API10 upstream handling | Malformed/oversized/slow provider results, retries, output encoding, third-party keys and outage classification |
| Injection/XSS | Text/chat/caption/display-name rendering, uploads/filenames, stored profile data; parameterized queries and safe output contexts |
| Recording/privacy | Host vs guest/other tenant read/write/share/delete; share revocation and signed URL expiry; logs/storage do not expose media/text |
| Supply chain/crypto | Lockfiles/SBOM/image and model hashes/licenses, installer signature/update trust, actual crypto integration and dependency advisories |

The active assistant is fixed-reply help, so an operational LLM attack surface is not established. For a future LLM translator/summarizer, pin the catalog release used; the canonical OWASP page currently presents the2025 list. Map all ten: prompt injection; sensitive disclosure; supply chain; data/model poisoning; improper output handling; excessive agency; system-prompt leakage; vector/embedding weaknesses; misinformation; unbounded consumption. [OWASP GenAI catalog](https://genai.owasp.org/llm-top-10/).

Treat spoken instructions/transcripts as untrusted content, never tool policy. Keep model outputs as inert text; validate any structured output independently. No model may grant roles, invite/export/delete or query another tenant merely because the transcript asks. Use tenant canaries, retrieval prefilters plus output authorization, model/source provenance, poisoned-corpus tests, and budgets/kill switch. Never put secrets in prompts or rely on a hidden prompt as access control. Test negation/numbers/speaker attribution and harmful omissions as quality risks. Retrieval/vector controls are conditional on adding retrieval, not a finding against today’s static helper.

## 10. CVSS methodology

Use CVSS v4.0 for reproducible security vulnerabilities; operational defects can remain reliability priorities. Record Base metrics AV/AC/AT/PR/UI and impacts VC/VI/VA/SC/SI/SA, including the vulnerable-system/subsequent-system boundary. Then evaluate Threat exploitation maturity and Environmental modified metrics/security requirements for the actual tenant deployment. Supplemental metrics provide context and do not change the score. Preserve the original scanner version when it supplies3.1; never relabel it4.0. [FIRST specification](https://www.first.org/cvss/v4.0/specification-document).

For each finding retain a full vector, calculator output/version, assumptions and per-metric rationale. A demonstrated cross-tenant recording read could have high confidentiality impact, but privileges, attack requirements and subsequent impacts require actual reproduction. It has no justified numeric score in this source-only report. A misleading Sign in button or503 is not automatically a high CVSS vulnerability. Combine severity with asset exposure, exploit evidence, tenant sensitivity and compensating controls for remediation priority.

Report template: ID, affected asset/revision, authorized test role/preconditions, actual/expected behavior, redacted requests/responses, reproducible steps, CWE, pinned ASVS/API/WSTG mapping, full CVSS version/vector/score/rationale, business impact, owner, fix/commit and retest evidence. Proposed remediation targets: critical containment 24h, high 7 days, medium 30 days, low 90 days, with documented business exceptions and expiry. These are proposed policy choices.

## 11. Authorized Burp Suite and Nessus plan

This is an assessment plan; no intrusive scan was executed. Authorization must name QSVC-owned targets (domains/IPs/tenant IDs/hosts), environments, test identities, source IPs, time window, rate/concurrency limits, emergency contact, data handling, allowed/destructive tests and stop criteria. The user’s request authorizes planning/source work; it does not identify live scan targets. Public Jitsi/InstaVC and cloud-provider shared infrastructure are research sources, excluded scan targets.

1. Prepare disposable staging tenantsA/B, guest/member/host/admin accounts, synthetic recordings/transcripts and known backup/restore. Inventory deployed revision, routes and IP ownership. Agree thresholds such as unexpected service impact, alert/SLO breach or unintended real data exposure that immediately stop testing.
2. Burp Proxy: restrict target scope, use dedicated browser profiles and redact credentials in exports. Capture login/logout, profile, scheduling, join/leave, WS, recording and sharing journeys. Verify auth state/history with browser automation as well as request replay.
3. Burp Repeater/manual: replay recording/meeting IDs across tenants/roles; test revoked sessions and host removal; inspect WebSocket membership/caption/moderation messages, malformed messages and bounded-rate behavior. Burp does not replace actual RTP/ICE/TURN testing.
4. Burp active scanner, when separately in scope: start with safe staging coverage, exclude destructive/logout/share/delete endpoints from unattended crawling, then test those manually. Community can support a manual baseline; Professional adds scanner/workflow capability. [PortSwigger workflow](https://portswigger.net/burp/documentation/desktop/testing-workflow).
5. Nessus: external owned-host scan for intended exposure, then credentialed staging OS/container-host assessment with least-privileged temporary scanner access and safe checks. Use approved commercial licensing; current Essentials/Essentials Plus are non-commercial, while the vendor page lists Professional for commercial use. [Nessus editions/limits](https://www.tenable.com/products/nessus/nessus-essentials). Verify licensing/quote rather than assuming free production VAPT.
6. Manually review SG/firewalls/IAM/S3/DB grants/TLS/container configuration and desktop installer/update paths. Network scan scores do not prove tenant isolation or cloud least privilege. Test media reachability, forced relay, credential expiry and controlled resource exhaustion separately.
7. Reproduce findings, remove false positives, assign CVSS with evidence, fix by owner, rescan affected checks and manually retest the original exploit and adjacent tenant boundary. Deliver executive/technical reports, coverage/exclusions, evidence and signed closure/risk acceptance.

Cost-conscious sequence: existing tests + manual Burp Community + lockfile/SBOM/image/secret tools → scoped licensed host assessment and Burp Pro if justified → independent assessor retest. Obtain tool/service quotes for the commercial scope; purchasing scanners is not itself an audit program.

## 12. Delivery sequence and release gates

Planning estimates assume a developer familiar with the code and a small pilot; model/provider quality and deployment constraints can change them.

| Stage | Owner / estimate | Exit gate |
|---|---|---|
|0 Local auth candidate | Backend/frontend + QA,2–4days production hardening | Focused/full suites, service/web builds, browser history/outage/race journeys, independent review; source candidate is not deployment |
|1 Supported deployment | Platform,2–5days | One internet and one LAN manifest, readiness, migration/restore, two-device direct+TURN, correct object storage and no exposed control API |
|2 Captions production path | Speech/backend,1–2weeks | Selected-track capture, configured Whisper+Google NMT, ja capabilities, consent, bounded queues, human Hindi/Japanese quality and latency gates |
|3 Optional voice | Speech/frontend,3–7days after captions | Caption/voice independence, Japanese voice, ordered/cancellable playback, echo/ducking/autoplay and budget evidence |
|4 Security closure | Platform/security,1–2weeks plus fixes | Auth/tenant/recording boundaries, expiring TURN, private control APIs, claims corrected; staging Burp/Nessus and manual retest |
|5 Governance | Service/privacy owners,30/60/90-day operating milestones | Scope/risk/SoA/privacy supplier/control evidence, internal audit and management review; assessor determines certification readiness |

Before production, require clean-install CI, real DB fixtures, actual configured providers, Chrome/Edge and supported Safari/Firefox capability paths, physical Windows desktop if sold, WAN/LAN/offline boundaries, load/churn/restore and rollback. Record exact browser/device/provider/model/image versions and environment. Missing evidence remains Untested, not a pass.

No current compliance, acoustic translation quality, production availability, capacity or vendor certification is asserted. Live AWS/billing/security groups/database state, secrets/history, real devices and intrusive VAPT remain outside obtained evidence. The implementation evidence and independent MADY card define the exact local result and remaining blockers.

## SFU control rollout

Set a dedicated random `SFU_CONTROL_TOKEN` in both SFU and signaling before
updating production. AWS and production Compose require it. Deploy both
services together. Keep port 4000 private and verify control requests reject
missing or incorrect credentials. The authenticated per-source limit is
1,200 requests per minute and requires load validation. See the
[VAPT execution record](VAPT_EXECUTION.md) for the authorized staging checks.

## Admin-approved enterprise access terms

Apply migration 006 before deploying this auth service. A platform admin with
a valid session can set or renew access using
`PUT /api/auth/enterprise/terms/{userId}`. Supply a workspace HTTPS URL and the
agreed end date as an explicit timestamp, for example
`{"workspaceUrl":"https://office.example.test/","expiresAt":"2027-11-04T18:00:00+05:30"}`.
The administrator chooses the exact contractual end date for monthly, annual,
or custom agreements. Renewal replaces the expiry and records who approved it.
The timestamp is exclusive. At or after expiry, the access API and Windows
download API return 403, even if the user also has a legacy environment grant.

Legacy grants without a stored term continue to work. Convert each existing
customer to a dated term when the expiry is confirmed. This API controls the
portal's workspace discovery and installer access. A separately hosted workspace
must enforce its own entitlement for direct links and existing sessions.
General internet meeting plans, billing, and an admin dashboard control
are separate work.

The admin console now verifies platform administrator access before loading
the dashboard. Under Users, open Enterprise access terms, look up the
customer by email, and save the workspace URL and agreed expiry. The lookup
shows the current expiry and rejects ambiguous email matches. The date and
time control uses the administrator's device time zone and submits UTC.

The scheduling form calls the persisted scheduling endpoint and saves the
waiting-room choice. Recurring series are still a separate feature.

### Restricted workspace expiry

On a QSVC-managed private workspace, set `QSVC_ENTERPRISE_TERMS_REQUIRED=yes`
in **both auth and signaling**. Use the same authoritative term records in the
workspace auth database. Provision accounts and terms before enabling this
mode. It blocks public signup and guest WebSocket access. Auth checks the
term at login and session verification. Signaling also rechecks idle
connections on heartbeat, normally within 30 seconds plus verification time.
This mode does not propagate grants to independent installations. The public
portal stays in its existing mode so an administrator can approve or renew
terms. A private deployment still needs its network and tenant policies.

Local migration 006 was applied and recorded on 4 November 2026. The local
database had an existing schema without matching migration records, so the
standard runner's attempt to replay migration 001 rolled back. The targeted
migration leaves the older migration records as they were. Reconcile those
records against the actual local schema before using the runner for a future
migration.

A rollback-only HTTP check against local PostgreSQL verified admin-only lookup,
saving a term, active access, expiry denial, and installer denial. The temporary
server used synthetic identities. This verifies the routes and database
queries. Browser sign-in and physical two-device media remain separate checks.
