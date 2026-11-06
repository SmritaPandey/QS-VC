# Meeting collaboration

Scope added November 3, 2026: shared whiteboard, polls, Q&A, shared notes, small attachments and connection of the existing host/waiting-room controls.

## User entry points

Open **More → Activities** for Whiteboard, Polls, Q&A, Notes and Files. Hosts and co-hosts also have host controls. The server determines roles; a participant cannot grant themselves privileges.

- Whiteboard: normalized pointer/touch strokes, pen colours and widths, undo own strokes; hosts can clear the board.
- Polls: hosts create/close polls; participants select one answer, with shared counts.
- Q&A: participants ask/upvote; hosts answer.
- Notes: explicit shared save with version checking. A conflicting save retains the local draft for manual reconciliation.
- Files: authenticated room-member uploads/downloads, PNG/JPEG/PDF/TXT, maximum 32 KB per file, 20 files and 512 KB total per room. This fits the existing signaling transport. Format validation is not malware scanning.
- Host controls: waiting-room admissions, participant moderation, room locking, chat/screen-sharing settings and host-controlled roles.

## Persistence and deployment limits

Collaboration data lives in the signaling process for the room lifetime. It is not a database archive, does not survive process restarts, and requires the same room owner for all participants. Save necessary notes/files before leaving. No claim of multi-region synchronization or large-webinar capacity is made.

Poll/Q&A voting uses participant connection IDs, not durable account identity; reconnecting is not an election-grade identity guarantee. Do not market anonymous voting: the server retains per-participant choices.

Whiteboard limits: 500 strokes, 20,000 points total, 1,000 points per stroke. Notes: 20,000 characters. Polls: 20 per room, 2–6 choices. Questions: 100 per room. Combined votes: 1,000. Collaboration RPCs have a per-participant rate limit.

## Verification boundary

Automated source/service tests and builds are recorded in task handoffs. Actual two-device media, waiting-room admission, simultaneous drawing, mobile panel fit and accessibility require browser/device verification. The optional post-quantum encrypted-media path was connected after this note; it still lacks independent cryptographic review, authenticated peer identity, FIPS 140 validation and physical two-device verification. Recording, breakout rooms, large-file storage, automatic transcripts, and AI meeting summaries still require separate implementation evidence.
