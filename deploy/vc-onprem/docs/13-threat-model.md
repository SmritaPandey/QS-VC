# On-prem threat model

ASSUMED – pending client approval: single-site pilot on private MPLS with managed endpoints and an isolated server segment. Model based on e6ae6cb and the P0 component inventory. Architecture review was sequential. Scenarios are hypotheses.

| Confidentiality priority | Assets and lifetime | Protection target |
|---|---|---|
| Highest | Root and signing keys, recovery material, backups (years) | Offline custody, separate signing and wrapping keys, encrypted backups and restore evidence |
| High | Classified meeting media, recordings, transcripts, chat (potentially years) | Authenticated hybrid key establishment across sites, local processing, object encryption, short retention |
| High | Audit records and identity mappings (months to years) | Restricted SIEM, integrity checkpoints, minimal PII |
| Variable | Session tokens and TURN credentials (minutes to hours) | Short lifetime, audience checks and revocation. Long-lived password material is separately protected |

Nation-state and carrier adversaries can record traffic for harvest-now-decrypt-later. Insiders can misuse delegated access. Supply-chain actors can influence dependencies or distribution before trust is established. An intranet host can reach only the flows the client firewall permits. Future signature forgery against classical roots and release keys is a separate risk from passive decryption.

| Boundary | STRIDE scenario and affected capability | Existing control and residual risk owner |
|---|---|---|
| Browser → Caddy → signaling | Spoofing and elevation via unauthorized join. DoS via join floods | Caddy rewrites client IP for signaling (config/Caddyfile.template:61). Meeting policy and ticket enforcement require UAT. Signaling owner verifies lobby and rate limits |
| Browser → auth → DB | Spoofing, elevation and repudiation of admin changes | Restricted DB roles and signed sessions in docker-compose.prod.yml. Identity owner must verify privileged MFA and admin audit evidence |
| Recording API → object store | Disclosure or tampering through cross-tenant access or leaked bearer share | Host ownership, hashed prefixes and revocable markers (services/recording/src/app.ts). Storage owner tests revocation and tenant isolation. Shared links remain sensitive |
| Endpoint → TURN → SFU | DoS and relay abuse | Shared-secret credential flow and peer policy in deploy/turn. Network owner validates allocation quotas and blocked peer destinations |
| Endpoint → SFU → Poly gateway | Disclosure and elevation across SIP, RTP and ESL trust boundaries | Optional bridge in legacy/compose/mcu.yml. Media owner isolates gateways and proves encrypted media support per endpoint. Legacy MCU remains out of scope |
| Signaling → ASR/MT | Information disclosure through speech processing | MeetingCaptions disables server ASR during E2EE. AI owner verifies no egress or implicit consent bypass |
| Services → internal listeners and database | Spoofing, disclosure, tampering | Current Compose uses private HTTP and purpose keys. Platform owner owns workload identity and mTLS gap |
| Builder → offline distribution → installer | Tampering, spoofing and rollback through a compromised update channel | Existing packager scans images and generates checksums. Release owner verifies signatures against independently pinned keys and enforces version control |
| Backup and SIEM → second site | Disclosure, deletion or repudiation | Storage/security owners validate encryption, immutable copies, retention and restore. Treat active host compromise separately from disk theft |

Critical impact includes control of release or trust roots. High impact includes cross-tenant access to protected recordings or admin takeover. Medium impact includes bounded denial of service. Low impact includes non-sensitive metadata leakage. Classifications depend on demonstrated reach and privilege. No severity here asserts a confirmed exploitable finding.

## AI data flow

The summaries RPC checks host or co-host access, transcript saving and E2EE
state before forwarding meeting text to the internal AI gateway. The gateway
applies per-feature policy and chooses local Ollama/vLLM, OpenRouter or a
custom HTTPS endpoint. Only an explicitly approved standard-profile route
may transmit meeting data outside the site. The gateway opens the client
credential in memory and records external call metadata to structured logs.
Treat provider custody, admin policy changes and quota exhaustion as separate
trust boundaries. The security owner validates egress and SIEM forwarding.
