# P0 outbound dependency audit

Source audit, not a packet-capture or disconnected installation test. Production
must be tested with internet egress denied before an offline claim is made.

| Dependency | Current use | Required action for isolated delivery |
|---|---|---|
| npm, container registries, OS package repositories | Connected builds and package installation | Build on an approved connected host; pin image digests, mirror OS packages, export images and verify manifests before transfer |
| Hugging Face / AI4Bharat | Whisper and gated IndicTrans2 model acquisition | Obtain model access and redistribution approval; transfer verified model files, manifests and licenses; never embed an HF token in images |
| Local ASR and MT | Configured internal HTTP/WebSocket endpoints; model security helpers validate staged models | Correct stale template endpoints; verify both directions and required languages with internet denied; align private API keys on caller and processor |
| Google Translation | Optional signaling translation provider | Disable for isolated delivery. Current on-prem template allows Google translation explicitly; replace that policy in P2 |
| Browser speech recognition and device speech synthesis | Browser/vendor-dependent recognition and voice availability | Do not promise offline recognition. Restricted deployments must disable remote recognition; allow only validated local speech processors and local voices |
| Minutes LLM | Operator-configured OpenAI-compatible or Ollama endpoint | Use an approved internal endpoint or disable minutes generation; validate endpoint and processing policy |
| Resend | Auth email verification, recovery and notifications when configured | Requires external API access. No validated local SMTP adapter; disable email-dependent promises or implement and verify an approved internal mail adapter |
| Google / Microsoft identity | Optional OIDC discovery and sign-in | Internet required for these providers; use local accounts or client-hosted identity. Keycloak is packaged but client AD/LDAP/SAML integration remains unverified |
| Razorpay, Cashfree, PayPal | Browser payment SDKs and backend payment APIs | Disable payments for isolated delivery. Do not enter provider credentials in the package |
| Frankfurter currency rates | Web currency conversion fetch | Use approved static pricing or disable conversion in the isolated build; disabling checkout alone does not remove this fetch |
| AWS S3 | Recording service constructs a regional AWS S3 client | An S3-compatible endpoint override is absent. Bundled MinIO is not a verified recording backend; implement and test the adapter or explicitly disable recording |
| WhatsApp, Telegram, Google/Outlook calendars | User-initiated sharing and calendar links | Hide external actions in restricted mode; use local meeting links and downloadable ICS where supported |
| Fonts and MediaPipe | Self-hosted web assets | Keep assets in the bundle and verify browser network requests; source uses local assets rather than requiring a runtime CDN |
| STUN / TURN | Deployment-supplied ICE configuration | Supply internal servers only; verify advertised media IPs and narrowly allow the private SFU peer in coturn |
| TLS issuance / trust | Caddy internal CA in existing template | Use client-issued certificate chain and trusted endpoints. Public ACME is not an offline prerequisite; renewal and distribution need an owner |
| Cloud tunnels and cloud deployment scripts | Development/cloud access alternatives | Exclude from the client launch path; use approved private DNS and routing |
| Vulnerability databases and release tools | Grype/Syft and signing/build infrastructure | Refresh on connected build host; transfer approved database/artifacts where required, record database age and exact scan result; never suppress scan failure |

## Blocking gaps before an offline release

1. No complete disconnected install or browser network trace has been recorded.
2. Existing image export tooling omits AI and Poly profiles, model files and OS mirrors.
3. Optional internet features need an enforced deployment policy, not just documentation.
4. Recording storage, client identity, TLS trust and mail need client-specific integration.
5. TURN over TCP/TLS 443 and UDP-blocked meetings need real endpoint verification;
   enabling HTTPS on 443 does not prove TURN fallback.
6. E2EE meetings cannot silently send decrypted audio to server ASR. Retain the
   existing restriction until an explicit consent/security design is approved.

## Evidence owners

Inspect `scripts/package-intranet-images.sh`, `docker-compose.prod.yml`,
`config/.env.onprem.template`, `services/signaling/src/translation.ts`,
`services/recording/src/storage.ts`, `services/auth/src/personal-oidc.ts`,
`services/auth/src/enterprise-access.ts`, `services/auth/src/personal-sign-in.ts`,
`frontend/web/src/lib/currency-rates.ts`, `frontend/web/src/lib/virtual-background.ts`,
`frontend/web/src/pages/PaymentPage.tsx`, `shared/model_security.py` and `deploy/turn`.
The environment inventory supplies additional configuration owners. Actual egress,
third-party licensing, certificate trust and provider readiness remain unverified.
