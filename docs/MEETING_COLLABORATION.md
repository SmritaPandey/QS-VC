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

## End-to-end encrypted rooms

**More → Activities → Notes** supports encrypted shared notes. The signaling process keeps the latest signed ciphertext and broadcasts it when notes change. Only meeting clients with the room key can read the text. Notes use a separate derived key from media and chat, and an edit to an older note version does not overwrite a newer save.

The current key holder reseals the stored notes after rotation so late joiners can open them. Recovery requires a live client with access to the preceding epoch to become or remain key holder. Secure notes have the same room lifetime as regular notes and a 32 KiB UTF-8 limit, within the signaling message size. Downloading notes saves a readable local file.

Encrypted rooms also support up to 10 shared files of 18 KiB each. File names, formats and bytes are sealed and the uploader’s signature is verified after decryption, including after a key holder reseals the file. Whiteboard, sticky notes, polls and Q&A are available in regular rooms. They require separate encrypted protocols to preserve editing permissions and restricted poll results.

## Verification boundary

Automated source/service tests and builds are recorded in task handoffs. Actual two-device media, waiting-room admission, simultaneous drawing, mobile panel fit and accessibility require browser/device verification. The optional post-quantum encrypted-media path was connected after this note; it still lacks independent cryptographic review, authenticated peer identity, FIPS 140 validation and physical two-device verification. Recording, breakout rooms, large-file storage, automatic transcripts, and AI meeting summaries still require separate implementation evidence.
