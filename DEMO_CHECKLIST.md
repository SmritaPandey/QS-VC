# QS-VC demo operation

Use an isolated demo database and synthetic names/content. Do not import client data.
Recording APIs and local recording are disabled; existing storage objects are not deleted.
Previously issued storage links and direct bucket permissions must be reviewed separately.

## Accounts

Run `npm -w services/auth run demo:accounts` only against the isolated database.
It requires `QSVC_DEMO_DATABASE=yes`, `DATABASE_URL`, and an absolute
`DEMO_CREDENTIALS_FILE` outside the repository. Credentials are written to a new
private file. Use the organisation code in that file on `/login`.
Do not use the legacy seeded administrator password for a shared demo.
Each demo account permits one active session. A new login revokes the previous
session. Logout revokes its server session; already connected clients are rejected
on their next authenticated request. Auth service/database availability is required.
Configure `VITE_AUTH_URL` for hosted deployments; local Vite proxies `/api/auth`.

## Meeting policy

Instant rooms assign host to the first arrival. Have the presenter join first.
Later arrivals are members; only the host can grant a co-host role.
This is an invite-only demo policy, not verified scheduled-meeting ownership.
Waiting room and E2EE scheduling options are unavailable in the demo.
A lost connection stops local capture and offers Rejoin meeting via preview.

## Final two-device rehearsal

Use two separate physical devices and the synthetic accounts. Confirm:

- Login succeeds; wrong password fails; logout makes the old session unusable.
- Host enters first; participant cannot run host actions.
- Both sides receive microphone audio and camera video.
- Camera off/on three times; tab switch stops camera; restart works.
- Messages arrive on the other device and history scrolls.
- Present a synthetic slide; the other device receives it; stop restores camera.
- Leave releases camera/microphone. Rejoin works.
- Interrupt the network, restore it, and use Rejoin meeting.
- Record controls are absent and recording API requests return 403.

Physical device and real database checks are not replaced by unit or protocol tests.
