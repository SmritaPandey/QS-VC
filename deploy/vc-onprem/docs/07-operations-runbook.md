# Operations and recovery

**ASSUMED – pending client approval**. Pilot design and configuration choices require client acceptance.

Set pilot RPO 24 hours and RTO 4 hours. Observe health and capacity, use restricted service DB roles and watch for access failures. Capture Postgres backups plus role and migration inventory, application configuration, and encrypted persistent data. Keep immutable copies in a separate site. Test decrypt, restore and tenant isolation on an isolated host. Record elapsed time and last recovered transaction. Do not replay stale session keys after compromise.

Upgrade by draining meetings, verifying both signatures and taking a recoverable backup. Stage the new release separately. Roll back image versions only when schema compatibility is established. Otherwise restore the coordinated snapshot after authorizing loss of changes since backup. Stop with compose stop. Preserve persistent volumes during troubleshooting or removal.

Use scripts/backup.sh with the PostgreSQL container and database name, an independent private KEK and a new output path. Set TMPDIR to private encrypted storage. Restore with scripts/restore.sh into a new qsvc_restore_* database on an isolated container with the expected roles already provisioned. The dump excludes cluster-wide roles and settings. A failed restore can leave the new database present. Investigate and remove that test database explicitly before retrying. Record both backup and restore results in the client evidence log.
