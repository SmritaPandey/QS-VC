# QS-VC review and remediation ledger — 11 November 2026

Scope: the supplied review and screenshots, checked against repository `30dc641`. This is a targeted source review, not a file-by-file audit, a production test, a compliance opinion or a certificate. Assumed load: a small investor demonstration today; customer and government deployments require separate capacity and failover evidence. Other agents are making local changes during this review; baseline findings below are not claims that those changes have been deployed.

The user's current context overrides older review assertions: Google/Microsoft SSO and SAML have source but no live credentials; no email provider is configured; intranet delivery is PDF guidance; desktop distributions are unsigned ZIPs. The pasted review is evidence to check, not authority to buy certificates, change accounts, rewrite Git history or claim certification. The Claude artifact could not be accessed by the lead; the complete pasted text is the review input.

Status vocabulary: **Source** = implementation located, runtime not proven; **Gap** = missing/incomplete integration; **External** = provider/operator action; **Retest** = local implementation needs deployed evidence. Every row has a closure check; recording a row does not close it.

## Local work in this task

Lead-reported validation: full Vitest run passed **98 files / 699 tests**; shared Python unittest passed **2 tests**. These are local results, not deployed acceptance. The lead blanked Razorpay key/webhook secrets in three environment templates and removed tracked certificate files from the working tree. Credential rotation and history cleanup remain open. The nginx TLS deployment is blocked until a replacement matching certificate/key is provisioned privately. Do not deploy the deleted certificate paths without replacements.

The lead also removed four tracked installer parts, their checksum and the update archive from the working tree, preserving a private recovery copy, and ignored `/deploy/aws/outgoing/`. History purge and permanent verified release hosting remain open.

CI now adds full-history gitleaks v8.24.2 with redacted output and fail-closed behavior, plus shared Python tests. Gitleaks was not run locally because the Docker daemon was unavailable; the full-history CI gate is expected to block production verification until historical exposures are cleaned up. No claim of a clean secret scan is made.

## Pitch-first sequence

1. Rotate exposed payment/webhook credentials and any identity using the tracked TLS key. Sanitize examples; remove private keys and build archives from tracked release content. Coordinate a separate history rewrite and collaborator reset; deleting a current file does not remove its history.
2. Keep checkout gated unless actual merchant terms, refunds, GST treatment, price, renewal, cancellation and reconciliation ownership are ready. Source already requires both `PAYMENTS_ENABLED=true` and `PAYMENT_TERMS_CONFIRMED=true`.
3. Adapt the screenshot checkout structure while retaining QS-VC's actual prices, providers and terms. Mark unavailable capabilities honestly; do not copy Google's free trial, discounts, identity, prices or claims.
4. Sign/notarize desktop releases with operator-provided credentials, then verify fresh downloads and updates.
5. Configure email before promising verification, reset or receipts. Configure Google/Microsoft and organisation SSO before calling them live.
6. Undertake the tender programme below as separately verified engineering and operations work.

## Corrections and evidence

- Auth is not entirely unthrottled: `services/auth/src/index.ts` attaches a 10-attempt/15-minute IP limiter to login and registration. That does not provide per-account lockout, distributed abuse control or CAPTCHA.
- `services/signaling/src/room-numbers.ts` is imported only by `room-numbers.test.ts`; the dial-by-number integration gap is supported.
- `deploy/poly-bridge/scripts/install-freeswitch.sh` uses Debian `apt-get`; a Rocky 9 installation is not supplied by that script. It attempts an H.323 package, which is not proof of working H.323/H.239 interoperability.
- `services/mcu/src/index.ts` explicitly identifies itself as a control-only placeholder with no media engine.
- Billing already calculates GST, verifies provider details, supports intro prices and has a cancellation outbox/reconciliation flags (`services/auth/src/billing.ts`, shared pricing, migrations 028–031). The review's instruction to add GST must not overwrite those working controls.
- Recording notice is not wholly absent in source: `PRODUCT.md` documents signaling broadcast of browser-hosted recording. It remains necessary to verify every participant's actual notice and consent flow. Browser composition/upload is not unattended server recording.
- CI has security-evidence tests, dependency audits, JS tests, build, SBOM and image scan. Lint currently allows failure. No SAST/secret scan/Python audit/DAST is established by the baseline workflow.
- `qsvcctl` already has lifecycle/status operations. Requested install/doctor functions must extend this existing owner, not create a competing CLI.

## Secrets, release hygiene and checkout

| ID | Item / baseline evidence | Status and smallest next step | Closure check |
|---|---|---|---|
| P01 | Razorpay secret/webhook values in `.env.example`, `.env.production.example`, `config/.env.onprem.template` | Local sanitization done by lead; External: rotate in provider and deployed secret store; history cleanup remains open | Old keys rejected; new sandbox/webhook round trip passes; no secret values in examples/history scan output |
| P02 | `certs/privkey.pem` and `fullchain.pem` are tracked | Working-tree removal done by lead; External: identify actual usage, rotate/reissue and provision replacement matched cert/key before nginx TLS deployment; coordinate history purge | Fresh clone and history secret scan clean; old identity invalidated where applicable; deployed certificate verified |
| P03 | Four `.exe.part*`, checksum and `qsvc-update.tgz` tracked under `deploy/aws/outgoing` | Working-tree removal and ignore added by lead; release storage, verified delivery and history cleanup remain open | Fresh release download hash verified; source clone excludes build payloads |
| P04 | `deploy/aws/installers`, `tmp`, `.secrets` backups and root `.env` | Operator: retain required files privately; audit bundle exclusions; do not blindly delete user's backups | Archive inventory contains no secrets, dev launchers or temporary source snapshots |
| P05 | No baseline secret scan or pre-commit protection | CI full-history gitleaks added by lead; local hook remains open. Local scan not run (Docker unavailable); never hide known leaks with a broad allowlist | A synthetic secret fixture fails the scanner; full-history findings triaged without exposing values |
| P06 | Checkout enabled according to user; source has dual enable/terms gate | External decision: merchant must confirm terms; keep gate closed when unready | Server refuses checkout while either gate is false; production configuration verified privately |
| P07 | Refund policy, cancellation/renewal terms, GST and customer consent | Source + External: retain existing tax controls; provide actual merchant policy/contact/terms before payment | Customer sees provider currency, base, tax, total, recurring frequency and accepted policies before provider handoff |
| P08 | `payment_captures.needs_review`, cancellation outbox | Source + operations: owner dashboard/report and daily alert; email waits for provider | Failed mandate/captured mismatch generates reviewed event; overdue cancellations alert; reconciled refunds logged |
| P09 | Screenshot checkout | Local: plan/billing selection, review heading, contact/payment section, summary, clear due-now and future charge, change actions | Keyboard + mobile/tablet/desktop + themes; server-authoritative totals; cancel/error/retry and provider return verified |
| P10 | Screenshots show Google ₹0/14-day/50% offer | Reference only: use QS-VC configured offer eligibility; no copied commercial facts | Summary matches shared pricing/server quote for trial, standard, intro, annual and upgrade states |
| P11 | Receipts / verify/reset email absent per user | External + Gap: configure provider and authenticated sending domain; add transactional flows | Delivery, failure, replay, expiry and enumeration tests; no false success when unavailable |

## Identity, security and VAPT register

| ID | Item | Status / next step | Closure check |
|---|---|---|---|
| QS-01 | Session-bound TURN/ICE and private-peer deny rules | Retest existing implementation | Admitted guest/host works; waiting/stale sessions and private/metadata relay attempts denied in every deployed profile |
| QS-02 | Electron 45.2.3; unsigned/not notarized builds; update trust | Partial: signing/notarization and trusted update channel | Real OS signature/Gatekeeper verification and tampered update rejection |
| QS-03 | Worker security headers/CSP/anti-framing | Retest public routes, errors, cached assets, payments/media | Browser/network capture confirms deployed headers and working intended flows |
| QS-04 | Ed25519 sessions; no public JWKS overlap rotation | Source + Gap: design key IDs, overlap, revocation and verifier distribution | Old/new keys overlap safely; revoked/legacy HS256 sessions rejected |
| QS-05 | Durable cancellation outbox | Retest all three providers; add operational alerts | Failure/retry/duplicate webhook/reconciliation/provider-terminal-state tests in sandboxes |
| QS-06 | Torch/TorchAudio 2.10.0 advisory claims | Open: current pinned dependency scan and compatible remediation | Fresh Python/container report plus real model/GPU test; do not assume old advisory counts remain current |
| QS-07 | Meeting E2EE keys not account-bound | Gap: identity binding, revocation/recovery and changed-key UX | Impersonation/key-substitution tests; account/organisation identity verifiable by participants |
| QS-08 | Origin HTTP secret gate, no established ACL/Tunnel | External + Retest: restrict origin ingress without breaking media/webhooks | Direct-origin denial and edge availability verified; network-level protection assessed separately |
| QS-09 | No password-user admin MFA/verified-email activation | Gap + email dependency: mandatory TOTP admin enrollment/recovery; verified activation; individual admins | Unenrolled admin blocked, replay/rate limit/recovery tested; unverified account cannot bypass activation |
| QS-10 | No security audit trail | Gap: protected append-only events, admin viewer, required India retention, reliable timestamps and incident owner | Coverage for auth/admin/payment/meeting actions; restricted reads; tamper/retention/restore tests and legal requirement validation |
| QS-11 | No audited frozen reproducible release/CBOM | Gap + External: tag/commit, image digests, build recipe, SBOM/CBOM, signed artifacts | Auditor can reproduce identity and trace deployed build to reviewed evidence |
| QS-12 | Pinned noble PQ library; no validation certificate | Source, not certification | Verified applicable CAVP/CMVP evidence for a specifically validated implementation; no unsupported product claim |
| QS-13 | TURN TLS overlay exists, real cert not proven | External + Retest: configure cert/SAN/renewal/reload | `turns:` connectivity, certificate chain/expiry and renewal drill on real deployment |
| QS-14 | Plan/marketing capability mismatch | Source + review: label unavailable features without changing real entitlements silently | Every paid inclusion maps to enforced backend capability and verified deployment |
| QS-15 | Prior lockfile dependency audit | Retest current lockfiles and built images, including Moderate triage | Dated reports and accepted risk/repair owner; historical clean result not presented as current |
| QS-16 | Closed-signup/existing-email response normalization | Retest timing/status/body across registration paths | Enumeration checks on deployed endpoint |
| QS-17 | JSON 404/metadata reduction | Retest all exposed services, history and release archives | No accidental debug metadata or internal identifiers in public errors/bundles |
| QS-18 | ECH | External: verify actual edge/DNS support/configuration | Public client negotiation evidence; no source-only claim |
| A01 | Password reset absent | Gap + email: single-use expiring hashed token, generic response, session invalidation | Expiry/reuse/account enumeration and stolen-token tests |
| A02 | Account lockout/CAPTCHA absent; IP limiter present | Gap: per-account/distributed throttling, sensible lockout/recovery, bot challenge appropriate to internet/intranet | Multi-IP brute force and shared-IP legitimate access tested; accessible challenge fallback |
| A03 | 24h default session; no idle logout/admin sign-out-everywhere established | Gap: reviewed shorter role-specific duration, enforced idle timeout and revocation | Server rejects expired/revoked sessions; idle warning/logout and multi-tab behavior tested |
| A04 | Password policy / breached password check | Gap: inspect registration owner and adopt suitable length/breach policy, not arbitrary complexity claims | Boundary/breached-password and error-response tests; existing accounts migration plan |
| A05 | Google/Microsoft personal sign-in and SAML/OIDC | Source, not live per user: provider keys/callbacks/Keycloak broker/configuration | Each provider real login/logout/invitation/tenant isolation; SAML broker metadata and certificate rollover |
| A06 | Signup/contact spam | Gap: server rate limit/challenge coverage including contact | Abuse rejected without breaking keyboard or intranet operation |
| A07 | Dev WebSocket origin relaxations | Packaging review: exclude development launchers/configuration | Customer bundle starts with strict origins; malicious origin connection denied |
| A08 | Python tests, pip-audit, SAST, DAST missing in baseline CI | Shared Python tests added by lead. Gap: pip-audit, SAST, authenticated staging DAST and report artifacts remain open | Intentionally failing fixture fails each relevant gate; results tied to build identity |
| A09 | Lint uses `continue-on-error` | Gap: clean existing failures then make gate blocking | CI rejects real lint failure |

## Conferencing, tender and operator workflow

| ID | Item | Status / next step | Closure check |
|---|---|---|---|
| T01 | Room numbers → Poly bridge | Gap: wire existing resolver into authenticated bridge/dialplan and meeting admission | Real SIP endpoint dials number, PIN/admission enforced; invalid/expired/locked room denied |
| T02 | Room numbers admin | Gap: add authenticated CRUD with room picker/PIN/auto-admit and test dial | Tenant/RBAC, conflicts, validation and live call state tested; never return PINs indiscriminately |
| T03 | Poly devices admin | Gap: device lifecycle/registration/secrets and scoped operator access | Register/revoke device; cross-tenant lookup denied; live status trustworthy |
| T04 | FreeSWITCH integration / MCU | Placeholder source: implement/verify actual bridge media engine; do not imply placeholder mixes video | Bidirectional audio/video, composite/RTMP/SIP recording as separately required, failure handling |
| T05 | Rocky Linux 9 installer | Gap: supported RPM path, OS checks, firewalld/SELinux, reproducible dependencies | Fresh Rocky 9 VM, reboot, uninstall/rollback and offline install tests |
| T06 | H.323, H.239/BFCP content | Not established: define supported endpoint/protocol matrix; package attempt is insufficient | Actual Poly interoperability and content sharing tested per model/firmware |
| T07 | Breakout rooms | Gap: server lifecycle/RBAC/admission/return and UI | Isolation, host assignment, disconnect/rejoin and closure tests |
| T08 | 1080p / media bitrate | Review claim needs full capture/encoding path inspection; high simulcast layer is 900 kbps in `media.ts` | Real endpoint negotiated capture/send/receive resolution, bitrate and constrained network tests |
| T09 | Four sharers, four cameras, 2–16 layouts | Gap/unverified tender requirement | Concurrency and layout switching on target endpoints and widths |
| T10 | HA/capacity | Gap: signaling state/failover architecture, measured room/node limits | Stated load tested; node/process loss and recovery exercised; no invented capacity |
| T11 | Server recording | Browser composition/upload exists; unattended server composite absent | Recorder lifecycle, encrypted-media tradeoff, storage/failure/retry and retention tests |
| T12 | Visible recording/consent | Source broadcast exists; verify everyone sees notice; join consent | Late joiners, reconnect, host stop/crash and screen reader announcement |
| T13 | Native Android/iOS | Gap: mobile web is not native | Signed app build and device/permission/background behavior test |
| T14 | Hindi/English everywhere | Gap: shared i18n, top-bar switch, app/admin/legal/errors | Complete route/string audit; script fonts, wrapping, persistence, screen readers |
| T15 | GIGW statutory/accessibility pages | Gap: accessibility statement, sitemap, hyperlink/copyright policies and required ownership | Reviewed truthful policies, links, keyboard/contrast/WCAG audit; no certification claim |
| T16 | White labelling/HIPAA | Gap/external requirement clarification | Tender scope agreed; verified controls/agreements rather than blanket HIPAA claims |
| T17 | Webinar | Stage/audience source exists; registration and branding incomplete | Server role/permissions, attendee registration and branding tests |
| T18 | Host mute / block self-unmute | Source checks exist; verify ask-to-unmute flow | Participant cannot bypass server permission; host recovery works |
| T19 | One join box for code/link/room number | Gap: shared validated parsing/resolution and safe navigation | All supported forms, malformed inputs and malicious links tested |
| T20 | Scheduling plan limits | Add from authoritative plan data | User sees limits; server enforces same limits and returns actionable rejection |
| T21 | Unified operator portal | Existing tabs: Overview, Meetings, Users, Recordings, System; add Room numbers, Devices, Audit log, Health, Licence | RBAC/tenant isolation; honest unavailable/error states; real operator task walkthrough |
| T22 | Health/version/digest | Existing status is not full operator health suite | Auth/signaling/SFU/TURN/FreeSWITCH/AI/DB probes; version/digest; stale/partial/failure states |
| T23 | CSV bulk user import | Gap: bounded validated import, preview/error report, duplicate handling | Tenant isolation and atomic/partial result policy tested; CSV formula injection handled on export |
| T24 | AD/LDAP via Keycloak | External + integration | Real directory sync, disable propagation, least privilege and outage behavior |
| T25 | `qsvcctl install` | Extend existing CLI; currently lifecycle/status owner | Checks OS, dependencies, ports, SELinux; safe rerun; no overwriting secrets |
| T26 | `qsvcctl doctor` | Gap: DNS/TLS/TURN/SFU and per-device SIP OPTIONS checks with fixes | Known failed prerequisites diagnosed; credentials redacted; exit codes usable |
| T27 | Offline customer bundle | User currently has PDF guides; full bundle not shipped | Images/models/RPMs/PDFs/checksums; isolated network install; license/provenance inventory |
| T28 | Status/support | Add truthful status page and footer support/feedback form | Real health data and actual support destination; no fake submission success |

## Release and developer workflow

| ID | Item | Status / next step | Closure check |
|---|---|---|---|
| W01 | Staging → tagged scanned promotion | Production workflow exists; establish staging/release promotion policy | Same immutable digest promoted with approvals/rollback; unscanned build blocked |
| W02 | Deploy smoke + ZAP baseline | `npm run smoke:deploy` exists; integrate actual deployment smoke and bounded staging DAST | Failing smoke blocks promotion; scan captures auth-safe coverage and artifact |
| W03 | Docs consolidation | Existing remediation register retained; this ledger complements it | One living status owner + one release checklist; links/archive map prevent conflicting current truth |
| W04 | Build storage / clone size | Move installers to Releases/S3; review history separately | Release checksums/signatures available; source archive excludes payloads |
| W05 | Incident response / backup restore | Documentation/operations gap | Named on-call/incident process; dated restore drill and recovery evidence |
| W06 | Access review | RLS/roles source does not replace periodic review | Current admin/service access inventory reviewed and stale access revoked |
| W07 | CERT-In audit freeze | External: obtain current scope/requirements from qualified auditor | Reviewed immutable build, signed report, remediation and deployed retest |
| W08 | Baseline tests | Prior 475-test claim is historical, not current evidence | Lead reports current local Vitest 98 files/699 tests and shared Python unittest 2 tests passed; deployed/runtime tests remain open |

## Certificate and compliance dependencies

The following is the user's proposed procurement list, not independently verified purchasing/legal advice. Exact eligibility, prices, statutory dates, retention obligations and certification applicability must be checked with current primary authorities before procurement or making a compliance statement. No purchase/enrollment/account change is authorized by this review.

| ID | Purpose | Dependency and action | Acceptance evidence |
|---|---|---|---|
| C01 | Public website edge TLS | Cloudflare Universal SSL configured in actual zone | Current public hostname chain/SAN/expiry and edge security test |
| C02 | Origin TLS | Cloudflare Origin CA or publicly trusted CA appropriate to actual connection path | Edge validates origin; key protected; expiry monitored; direct-origin controls tested |
| C03 | TURN TLS | Publicly trusted cert such as ACME/Let's Encrypt for TURN hostname | Actual client `turns:` handshake plus renewal/reload drill |
| C04 | Intranet TLS | Customer PKI/trust distribution | Client devices trust chain; SANs and revocation/renewal procedure verified offline |
| C05 | TLS lifetime automation | User cited 200-day/100-day transition dates; verify exact CA/B scope/dates before relying on them | Automated issuance/renewal, monitoring and emergency replacement independent of manual calendar |
| C06 | Windows code signing | Organisation-validated CA signing, protected hardware/cloud key; verify current Indian organisation/provider eligibility, including Microsoft Artifact Signing | Signed/timestamped installer and ZIP-contained executable; OS trust verified |
| C07 | Apple Developer ID/notarization | Apple Developer organisation enrollment, D-U-N-S/India process and current fee/eligibility checked directly | Developer ID signing, hardened runtime, notarization and stapling; Gatekeeper check |
| C08 | Linux packages/checksums | GPG key ownership/distribution for `.deb`, `.rpm`, `SHA256SUMS` | Signature verification with independently published trusted fingerprint |
| C09 | Container provenance | cosign/signing identity and registry policy | Digest signature/provenance verifies; unsigned/tampered deployment rejected |
| C10 | CERT-In VAPT / Safe-to-Host | Qualified external audit, current applicable scope and certificate terminology | Authentic report/certificate tied to audited build; retest closes findings |
| C11 | STQC / GIGW | Applicability and assessment programme | Actual issued evidence; accessibility testing alone does not certify GIGW |
| C12 | ISO 27001 | Organisation-wide ISMS scope, risk programme and accredited assessment | Current certificate whose scope covers the operation being represented |
| C13 | MeitY empanelment | Establish applicable scheme/entity/service criteria | Current official listing/approval, not an application or unrelated provider certificate |
| C14 | CAVP / FIPS 140-3 | Algorithm implementation testing versus module validation are distinct; architecture/provider selection requires expert review | Applicable verified certificate and approved module configuration; using an algorithm does not validate the product |

Safe cryptography wording pending verification: “uses NIST-standardised algorithms FIPS 203 / 204.” Do not say “NIST certified”, “FIPS validated” or broadly “NIST compliant product” without applicable evidence. FIPS 203/204, SP 800-38D/108/227, 800-63B, 800-53 AU/AC/SI/RA, 800-218 and CSF Respond/Recover are mappings for further assessment, not awarded product certificates. The supplied tender/RFP and clause/page references have not been independently obtained or validated here.

## Six-check engineering audit handoff

| Check | Concrete result / remaining work |
|---|---|
| Correctness | Room-number helper has no production importer; installer platform mismatch confirmed; billing source already owns price/tax/offer validation. Do not duplicate those rules in UI. |
| Security/data loss | Tracked private key and example payment credentials are priority exposures. Reset/MFA/audit/session revocation and trusted releases remain open. History removal alone cannot revoke a credential. |
| Scale | IP-rate-limit and process-local conferencing controls do not establish distributed abuse resistance or HA; capacity/failover remain unmeasured. |
| Risky tests | Provider sandbox, room/device integration, audit tamper/retention, recovery and deployed security retests required; existing unit tests cannot replace them. |
| Speed | Build payloads in source create unnecessary clone/release cost. No measured service latency/performance conclusion was made. |
| Lean | Reuse existing billing/pricing, `qsvcctl`, admin portal and remediation register. Avoid a second payment calculation layer or a competing operator CLI. |

Verdict: resolve credential exposure first; ship an honest, server-backed checkout experience and capability labels for the pitch. Tender readiness remains incomplete until the named implementations and external evidence are complete.

Not checked: complete repository line-by-line, live production, provider accounts, current certificate procurement rules/legal requirements, actual customer devices/OSs, cloud infrastructure and historical scanner claims. No scan/test result or external certification is inferred from this document.
