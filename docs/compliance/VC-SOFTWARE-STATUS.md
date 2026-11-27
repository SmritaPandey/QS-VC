# VC software implementation status

Source: VC Compliance.pdf, UPDESCO UPSWAN 3.0, section 26 (printed pages 194–201). Section 27 field-workforce application, hardware, network/deployment obligations, support processes and capacity/licence quantities are outside the user's requested software scope. Native Android/iOS store applications are explicitly deferred by the user.

This is an implementation record, not a compliance certificate. Existing work was preserved. No production deployment is implied.

## Connected in this implementation

- Host transfer: participant action, confirmation, duplicate prevention and error/retry; live moderation transfer preserves the meeting organiser.
- Breakouts: create, assign, open, join, return and close; same websocket admission and rebuilt media/encryption sessions. Backend regression covers repeated visits and forced-return notification. Real multi-client media verification remains necessary.
- Attendance and quality: report routes registered, authenticated organiser/admin saved access, live report, historical session identifiers, pagination and retry. Attendance excludes intervals spent outside a room. Speaking time estimates sampled microphone sound activity, not speaker identity.
- Broadcast integration: canonical participant notice, late-join snapshot, status cleanup on transfer/departure, HTTP/WebSocket forwarding, controller remains mounted when its controls close. External encoder/provider delivery remains unverified; external destinations must be configured. E2EE meetings cannot broadcast decoded media.
- Existing additional cameras, concurrent presentations, site labels, lock badge and collaboration board retained; missing quality/camera/local-record menu actions connected.
- Webinar registration pagination reaches older records beyond the former 1,000-record truncation, retaining organiser/tenant checks and approval page position.

## Follow-up implementation

- Central administration can mute public microphones and turn off participant cameras without joining the meeting. It pauses current SFU producers, including additional cameras. The server verifies platform administrator access and logs action metadata. Participants retain control of turning their own devices back on. Screen sharing and private audio are outside these controls.
- Organisation branding supports tenant-scoped names, PNG logos and accents. Settings appear in the admin console and apply to prejoin and meeting headers. Migration 036 must be applied before verifying persistence against PostgreSQL.
- Hosts can connect or disconnect an authorised Bharat VC invitation via the SIP bridge. The UI announces the external conference and requires explicit sharing consent. The bridge excludes private audio and requires SIP TLS and SRTP. An authorised call must verify that the gateway negotiates these settings and accepts the SIP PIN, and that two-way audio/video and disconnect work. H.323 dial-out is outside this Bharat VC implementation.
- Required-E2EE meetings use signed encrypted text chat and reject plaintext chat. Whiteboards, files, notes, polls and Q&A are disabled in these rooms until encrypted collaboration is implemented. Full collaboration E2EE remains open. The key and message protocol changes still need independent cryptographic review.

## Live acceptance still required

Use a staging media stack and two devices. Verify simultaneous audio/video, breakout transitions and return, text chat across a key change, admin microphone/camera actions, branding persistence after reload, and Bharat VC two-way media with an authorised invitation. Browser component checks and mocked protocol tests do not establish live interoperability. Native mobile applications remain deferred.

## Self-managed installer and government pilot

The Linux appliance package includes the SFU-side Bharat VC bridge. The site
administrator can enable it with the persistent organisation Compose override
and connect to site-operated FreeSWITCH and drachtio. These gateway services
still require separate provisioning. Bharat VC and ordinary room-device
bridging require an interoperability meeting. An authorised government SIP
invitation and two-way media test remain required.

The installer now checks the gateway with certificate verification. The local
recording service is started with the appliance and provides the existing
RTMPS broadcast path when a destination is configured and outbound access is
approved. This deployment still needs qualified server recording storage.

| Section 26 acceptance | Status |
| --- | --- |
| Customer-run clean Linux installation and branch trust | Source and Compose checks complete. Signed bundle build, clean host installation and two-client media remain pending. |
| Existing installation upgrades | Blocked. The installer can record migration filenames without running their SQL against an existing volume. Existing ledgers need reconciliation before production upgrades. |
| Government SSO and SHQ alternate access | Site IdP, private DNS, branch routing and firewall failover require customer environment integration and acceptance. |
| NIC/Bharat VC and mixed-codec rooms | Source available for SIP audio/video, subject to authorised media test. Mixed-protocol presentation forwarding, gateway qualification and 100 Full HD ports remain open. |
| Capacity | Separate acceptance runs required for 300 participants, 1,500 interactive participants and 30,000 simultaneous webinar viewers. Current interactive admission and webinar delivery require further work. |
| Security and operations | Negotiated cipher evidence, feature compatibility in required-E2EE rooms, India deployment, SLA and 24×7 support require release and site evidence. |
| Native iOS and Android clients | Deferred by user. Record the exception in tender qualification. |
