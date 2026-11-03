# QS-VC requirements for the approved live release

Recorded 2 November 2026 from the product owner's instructions.
These are future requirements, not implemented or measured capacity claims.
Current priority is building and validating the database. Do not provision webinar
infrastructure, raise room limits or treat these targets as current demo requirements.
Budget and capacity planning will be revisited after approval to make the service live.

## Webinar target

- Up to 30,000 concurrent attendees in a webinar.
- Up to 15,000 simultaneous audio/video broadcasters, explicitly authorised by an
  administrator or a group of administrators. This means simultaneous broadcasting,
  not merely a pool of attendees who can take turns speaking.
- Administrators can grant/revoke broadcasting permissions individually or by group.
- Enforce publishing permissions on the server; clients cannot promote themselves.
- The viewing/subscription policy (which streams each person receives), active-stage
  size, media quality, latency and regional distribution remain to be specified.
- Requires distributed media design, network/cost modelling and staged load tests.
  A database limit or room-cap setting alone cannot establish this capacity.

## Normal meeting access

Use Google Meet as the reference for guest and signed-in participation, adapted to
QS-VC rather than copying unspecified Google account or subscription rules.
Define and implement host admission, guest identity, signed-in identity, invitation
rules and host/co-host privileges. Never grant host ownership simply to the first
unverified participant who arrives. Exact access-policy defaults require a product decision.
Reference: https://support.google.com/meet/answer/9302870

## Deployment continuity

- Hosted service: AWS backend with private PostgreSQL (`qs-db`, database `qsvc`).
- Windows intranet: independent local backend/database, usable without internet when
  all required identity, language, DNS and certificate dependencies are available locally.
- Travelling staff: secure VPN access to the intranet when the office has internet.
- No implicit cloud/local database switching or automatic bidirectional replication.
- Preserve the current application structure; use deployment configuration where possible.

## Live-release gates

Before advertising capacity or handling real customer data: verify server permissions,
paid recording entitlements, retention, backup restore, TLS, database recovery,
multilingual processing disclosures, meeting admission and login/logout. Test the
specified participant/broadcaster load and publish only demonstrated limits.
Do not claim active post-quantum media encryption or ISO certification without evidence.
