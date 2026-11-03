# Demo recording policy

Recording is disabled. Every `/api` request returns HTTP 403 with code
`RECORDING_DISABLED`; `/health` remains available and reports
`recordingEnabled: false`. The service does not connect to PostgreSQL or object
storage and does not create, list, upload, or issue download links for recordings.
There is no environment switch to reopen the former unauthenticated routes.

Existing stored objects are not deleted. Previously issued object-storage URLs
may remain valid until they expire; restrict direct bucket access separately.
Restart the recording service after updating it.

Before reintroducing recording, implement authenticated meeting ownership and
tenant checks on every operation, participant notification, and an agreed
retention/deletion policy. Keep the demo UI's local recording controls disabled
as well.
