# QS-VC website content plan

Development-only editorial record. Do not ship this file, its readiness notes or source inventory in the public website. Scope: the14 architecture Markdown documents and6 documents under docs reviewed for the current website task. Architecture and older manuals describe intended capabilities; they are not completion records.

## Public communication rules

- Present QS-VC as an application, without demo, prototype or pilot framing.
- Explain user tasks, benefits, choices, availability and relevant privacy information.
- Keep providers, algorithms, infrastructure, schemas, deployment commands, implementation gaps and internal approval procedures out of ordinary marketing flows.
- Do not conceal material processing, recording, access or retention choices. Explain these in plain language at the point of use and on relevant privacy/security pages.
- Use one unobtrusive caption-example qualification. Remove repeated participant/sample notices.
- Preserve descriptive alternating upright visuals, shared action buttons, scroll reveals, light identity, ambient background and static footer. The newest upright-image request supersedes earlier camera-tilt directions.

## Source reconciliation

Reviewed architecture01–14, USER_MANUAL, MCU_USER_MANUAL, IMPLEMENTATION_ALIGNMENT, EXISTING_LANGUAGE_CONNECTORS, DATABASE_RESILIENCE and LIVE_RELEASE_REQUIREMENTS. The roadmap's checkmarks and manuals' present-tense descriptions do not establish current implementation.

Source spot-checks: active meeting, preview, scheduling and control routes; shared/crypto/pqc.ts; frontend/web/src/lib/e2ee.ts; searches for their runtime consumers and encoded-frame transform hooks. This is a content substantiation check, not a complete security audit or a cryptographic validation.

## What the homepage should explain

| Section | User-facing subject | Useful visual | Publication boundary |
| --- | --- | --- | --- |
| Introduction | Browser video meetings, sharing and language choices. Start a meeting or join an invitation. | Compact upright participant grid, with no overlapping portraits. | Existing application routes; no customer numbers or reliability metrics. |
| Before joining | Choose your display name, camera and microphone. Keep devices off when preferred. | Preview with name, camera and microphone details alongside each other. | Explain actual preview choices, not device certification. |
| During a meeting | Gallery, Focus, Sidebar, Filmstrip, screen sharing, chat and hand raising. | A document, participant tiles and a concise chat example. | Whiteboard, polls, Q&A, shared notes and small files now have room collaboration implementations; see MEETING_COLLABORATION.md for limits and runtime verification. Do not promise collaborative document editing or breakout rooms. |
| Your language | Speaker opt-in, captions and independent listening preferences, including translated audio where available. | Six distinct written examples, cycling gently and stopping after manual choice. | Written examples do not establish installed language-pair or speech-quality coverage. Actual choices appear inside the meeting. |
| Organisation | Schedule a conversation and share its invitation. | Meeting preparation and participant controls. | Invitation copying is implemented; email delivery, calendar sync and recurrence must be independently traced before being advertised. |
| Privacy and control | Decide when to share camera, microphone and speech as captions. | Clear personal controls, with no always-on security badge. | Do not equate personal controls with active participant-only or post-quantum encryption. |
| Deployment | Online and organisation-hosted conversations; discuss private-network and travelling-staff requirements. | A simple customer-facing comparison, not a network diagram. | Customer-hosted, offline and VPN arrangements require deployment validation. No automatic cloud/local failover promise. |
| Plans and questions | Explain rates, recording availability, guest/account access and organisational enquiries. | Existing rate cards and concise FAQs. | Preserve proposed rates and current availability rather than turning proposals into purchased entitlements. |

Suggested overview copy:

“Video meetings for the way your team works. Meet in your browser, share your screen and choose how you follow the conversation. Connect online or discuss an organisation-hosted setup.”

Suggested privacy copy:

“Your participation, your choice. Check your devices before joining, decide when to use your camera and microphone, and choose whether to share your speech as captions.”

## Quantum-safe positioning: important, but not substantiated as active

architecture/04_quantum_security.md specifies post-quantum key establishment and signatures, participant media encryption, rotation and stored-data protection. These belong in the product's security strategy and eventual security page.

Current evidence does not support advertising active quantum-safe meetings. The PQC helper attempts to load a runtime asset and otherwise uses classical fallback algorithms. The inspected application/service source has no discovered PQC-manager integration or active E2EE sender/receiver transform consumers. IMPLEMENTATION_ALIGNMENT explicitly calls these experimental/dormant and requires protocol review before activation. Names, comments, badges and compliance flags are not implementation proof.

Public wording that can be used only with an explicit planned-state label:

“Quantum-safe security is part of QS-VC’s development roadmap. Contact us to discuss your organisation’s protection requirements.”

Prefer a concise security enquiry on the current homepage until the capability is active and independently validated. Do not imply that a future roadmap feature protects a present conversation.

After validation, the security page should explain in plain language: what is protected, who can access it, supported applications/devices, how language assistance or recording affects privacy, and the exact deployment's verified security scope. Keep algorithms and implementation details in optional technical material.

Do not publish “first of its kind”, “quantum-proof”, ISO certified, FIPS compliant, zero knowledge, India-only processing or guaranteed protection without appropriate evidence. “First” additionally needs a precise category and dated independent market substantiation, which these documents do not contain.

Standards references for internal review: NIST FIPS203 specifies ML-KEM; FIPS204 specifies ML-DSA. Legacy Kyber/Dilithium naming alone does not demonstrate conformity with those final standards:

- https://csrc.nist.gov/pubs/fips/203/final
- https://csrc.nist.gov/pubs/fips/204/final

## Related pages and useful content

| Page | What users should see | What stays out |
| --- | --- | --- |
| Features | Prepare, meet, present, follow and organise, each with actual controls and a useful example. | Unconnected roadmap features and fictional live data. |
| Security and privacy | Personal sharing choices, actual protection scope, processing choices and recording/retention information. Quantum-safe capabilities only with a truthful availability label. | Provider wiring, keys, protocol scaffolds, unverified certificates or badge walls. |
| Languages | How speakers opt in, how listeners choose captions/audio, original-audio recovery and captions-only availability. | Claimed29/39/all-local-language coverage inferred from a catalogue or model family. |
| Deployment | Hosted and organisation-hosted options, private-network access and a requirements enquiry. | Server inventories, ports, database endpoints, configuration and internal cost estimates. |
| Plans | Preserve the four approved rate cards. Explain the commercial terms and availability that need confirmation. | Architecture financial models presented as current prices or entitlements. |
| Contact | Ask intended use, organisation, preferred deployment, language needs and approximate meeting needs. | Unnecessary sensitive data or implied approval/provisioning. |
| Sign-in and launcher | Assigned-account sign-in, guest joining, create/share/schedule actions and honest loading/error outcomes. | Unimplemented OAuth/SSO promises and internal session diagnostics. |
| Preview | Display name, microphone/camera selection, privacy choices and the next join action. | Security assurances inferred from UI switches. |
| Schedule | Title/time/duration and a shareable invitation after successful creation. | Email delivery, recurrence or calendar integration unless verified end to end. |
| Meeting | Real controls, availability and recovery. Essential consent near speech/recording actions. | Unconditional E2EE status when not actually active. |
| Recording/library | “Recording is not currently available. Paid recording is planned.” Later show authorised playback/download/delete and retention choices. | Fake recording files or claims of working private storage from architecture diagrams. |
| Help/FAQ | Join permissions, guest access, device/browser requirements, captions/voices, invitations and organisational setup. | Staff setup commands or internal engineering status. |

These are proposed content destinations. Creating new routes is separate from documenting this plan; existing routes are preserved by the current UI repairs.

## Capabilities to hold out of the available-feature list

The documents propose more than the connected application currently demonstrates: automated notes/summaries, sentiment analysis, live dubbing/voice cloning, whiteboards, breakout rooms, large webinar figures, room-system SIP/H.323 interoperability, telephone joining, MCU mixing/transcoding, SSO/SCIM/MFA, compliance dashboards, tamper-proof audit storage and active post-quantum participant encryption. Publish each only after its actual user journey and deployment scope are verified.

The latest release document's30,000 attendees/15,000 simultaneous broadcasters are future targets, not a current website capacity claim. The MCU manual's room/device claims likewise require independent runtime evidence.

## Current repair and evidence

The active code repair bounds hero/feature imagery, removes conflicting old spatial CSS, puts preview device details in a compact row, removes repetitive notices, adds guarded automatic language cycling, and restores a visible ambient layer and upright entry reveals. Public text avoids internal provider/setup language.

Browser control is disabled in Work settings. Source structure and build/unit checks do not establish visual, motion, contrast or physical-device acceptance. The independent Verdict Card must remain separate and unchanged; previous screenshots cannot prove these repairs. No deployment or new security feature is implied by the content work.


## November 3 collaboration update

Homepage now describes the shared whiteboard, polls/Q&A, shared notes, small attachments and host/waiting-room tools added in this work. These are live-room capabilities, not durable archives. Files are limited to 32 KB; room data is process-local. Browser/device verification remains pending. See [meeting collaboration scope](MEETING_COLLABORATION.md).
