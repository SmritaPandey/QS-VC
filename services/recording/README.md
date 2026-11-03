# Private cloud recording

Set `RECORDING_BUCKET` to a private AWS S3 bucket and `AWS_REGION` to its region.
The AWS demo stack supplies scoped instance-role access; no browser credentials
or public bucket is required. Without a bucket the API returns 503 and health
reports `recordingEnabled: false`. Health reports configuration, not verified S3
connectivity.

Every owner operation verifies the current session with the auth service and
checks persisted meeting host ownership with the meeting service. Guests and
co-hosts cannot save or manage cloud recordings. Objects are namespaced by hashed
tenant and owner IDs plus meeting code. No database credentials are needed by
this service.

- `POST /api/recordings/:meetingCode`: raw WebM/MP4, maximum 80 MiB, up to two
  simultaneous buffered uploads. `X-Recording-Id` is an optional UUID retained by
  the client across retries. Conditional S3 writes prevent overwriting a saved
  object; successful retry returns existing metadata. The original host can
  finish uploading after the meeting ends. Cancelled/disallowed meetings reject
  uploads.
- `GET /api/recordings/meeting/:meetingCode`: host-only paginated list; pass
  returned `nextCursor` as `?cursor=...` for older pages.
- `GET /api/recordings/:meetingCode/:id/playback`: host-only media URL, valid for
  five minutes. The browser uses this for playback or a requested download.
- `DELETE /api/recordings/:meetingCode/:id`: host-only deletion and share cleanup.
- `POST /api/recordings/:meetingCode/:id/share`: intentionally creates a new
  256-bit token and invalidates the previous share link.
- `DELETE /api/recordings/:meetingCode/:id/share`: revoke sharing.
- `GET /api/recordings/shared/:token`: anyone possessing the intentional share
  link can request playback. Only token hashes are stored. Revocation prevents
  new URLs; already-issued media URLs can remain usable for five minutes.

Recordings are retained until the host deletes them. The stack has no automatic
expiry lifecycle, blocks public access, requires TLS and encrypts S3 objects.
Configure bucket GET/HEAD CORS for the public website origins so requested browser
downloads can read the signed media response. Stack deletion retains the bucket.
S3 storage and transfer consume credits or incur charges.

The browser composes the host's visible meeting layout with mixed audio and
uploads on stop. This is not unattended server-side recording. It stops near
70 MiB to leave headroom below the upload cap, approximately seven minutes at
the configured bitrate. The host must keep the tab open until upload completes.
Failed uploads keep an in-memory copy with Retry, manual Download and confirmed
Discard controls; closing the browser can lose this unsaved copy. No automatic
local download occurs.

Recording notifications are sent through signaling to all participants, including
late arrivals. They do not replace any permissions the host must obtain. AWS and
real multi-participant verification are still required before release.
