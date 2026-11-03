# QS-VC product context

<!-- impeccable:product-schema 1 -->

Scope: QS-VC-private only. This record does not govern other projects.

## Platform

web

## Users

Government and private-organisation evaluators, meeting hosts, participants and administrators.

## Product Purpose

A video-conferencing platform with a public website and operational meeting and administration interfaces. The immediate user goal is a working demonstration for government and private parties.

## Operating Context

The repository contains a React/TypeScript/Vite web client, Electron desktop wrapper and separate conferencing services. Internet and intranet environments are in scope for the product. Actual offline operation and deployed capabilities require separate verification.

## Capabilities and Constraints

The web client exposes website, pricing, launcher, scheduling, preview, meeting, meeting-end, recording and admin routes. The current redesign authorises presentation and styling changes while preserving application logic, infrastructure, route paths and repository folder structure.

Meeting connectivity, captions, translation and encryption must not be described as newly operational or verified through a styling change. Listener-selected language is a product requirement, not a verified feature. The user explicitly approved Whisper and Google Translate on 2 November 2026, superseding the earlier exclusion. Use an explicitly configured Whisper runtime and the official Google Cloud Translation API. No undisclosed provider fallback or browser-bundled provider credentials.

## Brand Commitments

QS-VC retains its name. The user approved a navy identity, restrained teal actions, neutral working surfaces and IBM Plex typography with multilingual script support. Exact visual roles belong in the design record after implementation. The user reviewed image studies, requested a closer reference-led direction with distinctive buttons and replacement ambient treatment, and explicitly authorised direct implementation.

## Evidence on Hand

The repository provides source, architecture documents and user manuals. Existing public metrics, named testimonials, competitor comparisons and security assurances have not been established as verified proof. They must not become assumed product facts.

## Product Principles

- Preserve working controls and user flows during visual changes.
- Distinguish available functionality from proposed or illustrative content.
- Keep meeting participation readable during long sessions.
- Support local font delivery for intranet use.

## Accessibility & Inclusion

The redesign must support keyboard interaction, responsive layouts, reduced motion and script-aware multilingual typography. Rendered accessibility and performance require verification before acceptance.

## Confirmed presentation decisions

The public website and operational workspaces stay light; only the meeting room uses the dark palette. The unnecessary standalone 3D room was removed. Scroll storytelling uses a proportional meeting preview with restrained perspective framing and a static reduced-motion fallback.

The footer follows the supplied AI SaaS landing-page reference: aligned navigation and contact columns, a metadata baseline and one large static QS-VC wordmark at the bottom. The latest instruction removes all wordmark movement and supersedes the earlier marquee request. No animation pause control is shown. Existing valid routes and contact actions are retained instead of adding unsupported newsletter or legal flows.

## Meeting camera privacy

The user chose to stop the camera when the meeting tab becomes hidden. Returning to the tab must leave video off until the user explicitly starts it again. Microphone audio continues during tab switches. Camera controls should reflect browser/device interruption and allow a fresh capture attempt without a page reload. Leaving the page releases owned captures.

## Current meeting presentation

On mobile, microphone, camera and language controls form a floating side dock. It hides after four seconds of inactivity and wakes on input or a muted-sound reminder. Bottom controls stay in a floating dock; More contains view choices and additional actions. Available views are Gallery, Focus on me, Sidebar and Filmstrip. Visual view changes keep participant audio mounted.

Meeting chat is a compact translucent feed without a visible heading. It shows approximately three to four recent messages on ordinary phones and four to six on larger screens, with a smaller scrollable area in short landscape layouts. Older messages remain accessible. The assistant has a separate panel and is explicitly a local demo of control-help replies.

Muted-sound reminders analyse a local microphone clone while the microphone is muted, the page is visible and the meeting is connected. The clone is never published, recorded or played back. A small actionable strip appears for five seconds and can repeat after twelve seconds of sustained sound. This is sound-level detection and can respond to background noise.

Participant name badges use user-requested frosted navy glass and a soft teal edge glow. The assistant trigger sits near an upper canvas corner to avoid the bottom name badges.

## Public website decisions

The homepage, plans, launcher, sign-in and contact pages share the navy/teal/Plex identity in light and dark appearances. Follow the device appearance by default, using light when no dark preference is available. Users can choose System, Light or Dark. Retain the existing moving hero background and its reduced-motion/data-saving fallback. Keep the original four rate cards and their existing proposed rates/inclusions; do not silently replace the cards with status panels. Proposed rates and features are not confirmed purchase entitlements.

The public header has Meetings, Plans, Contact and account access, without a Languages item. After the header scrolls away, an animated side navigation offers page shortcuts; phones use a compact expandable control. Language content remains in the page and meeting controls. Public contact/sales actions use an enquiry form rather than mail-app links. Calendar email addresses inside iCalendar files remain protocol data.

The create/join launcher uses two equal columns on larger screens and stacked full-width cards on phones. Hiding a decorative divider must not leave its grid track behind.

The current language demo connects browser speech recognition, configured LibreTranslate and device voices. Whisper and Google remain permitted future/configured options, not active fallback providers in that meeting flow. Installed English/Hindi translation was checked with synthetic text; acoustic quality and other language pairs remain unverified.

## Recording decisions, 3 November 2026

The user requires cloud recording, with no automatic local download. Recordings
remain until the host deletes them. The recordings library offers manual Download,
Delete, Create share link and Disable sharing actions through a three-dot menu.
Implementation composes video and audio in the signed-in host’s browser and uploads
the result to private S3 storage on stop. Participant recording state is broadcast
through signaling. Failed uploads retain an in-memory copy with retry, manual
download and explicit discard actions; browser closure can still lose an unsaved
copy. This is not unattended server-side recording.

Source and local tests do not establish deployed availability. AWS bucket/server
creation and actual multi-participant recording/playback remain unverified. The
demo has an 80 MiB upload cap and stops capture near 70 MiB. Intentional share links
are revocable; previously issued signed media URLs can remain usable for five minutes.
