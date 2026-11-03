# Review repairs and responsive pass — 3 November 2026

- Auth verification exempts short-lived signed internal calls from public quotas; other requests are limited per credential. Signaling denies the current operation on transient verification failure without declaring the session revoked. Invalid credentials still close the connection.
- Logout distinguishes invalid sessions (401) from database/service failure (503), preserving the browser retry path.
- Signaling loads the saved meeting owner/settings through a service-authenticated meeting endpoint before joining. Stored setting names are mapped to live controls. The saved organiser must arrive before guests; the organiser receives host role. A missing record explicitly permits the existing instant-guest meeting behaviour. Storage failures do not fall back to guest ownership. Meeting passwords are removed from public preview and room notifications. Meetings requiring unimplemented participant E2EE are rejected rather than silently downgraded.
- AWS auth receives enterprise approval configuration and a read-only installer directory; absence of a real installer keeps download unavailable.
- Optional-storage denial takes precedence in memory when browser writes fail, and removal attempts are independent of saving consent.
- Mobile meeting layout uses a persistent bottom bar for mic/camera/assistant/More/Leave; secondary actions move into More. Panels fit above controls. Join preview uses portrait stacking and landscape columns. Public forms, plan grids and intranet/payment layouts have phone/tablet breakpoints.

Reference: https://support.google.com/meet/answer/12562325 and https://workspaceupdates.googleblog.com/2025/02/google-meet-call-control-updates.html . These informed compact control hierarchy; QS-VC keeps its own theme.

Runtime prerequisite: matching JWT_SECRET for auth/signaling/meeting, reachable MEETING_INTERNAL_URL (default localhost:4003), migrated and ready database. Previously observed local database failure must be resolved; this change intentionally does not bypass failed ownership validation.

Rendered browser/device QA remains blocked by Work settings disabling local browser access. No AWS deployment, Windows installer release, or physical-device media validation is implied.
