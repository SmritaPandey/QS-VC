# Production database roles

The production Compose profile now refuses to start Auth and Meeting with the PostgreSQL superuser. Use the restricted login roles created by the migrations.

## One-time setup

1. Apply the checked-in database migrations using the database administrator account. This creates the `qsvc_auth_service` and `qsvc_meeting_service` privilege groups, enables and forces row-level security, adds the meeting and transcript tenant policies, and grants only the table operations each service needs.
2. As the database administrator, run `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f db/create-application-accounts.sql`. Enter separate, randomly generated passwords at each prompt and store them in the deployment secret manager.
3. Set `AUTH_DB_USER=qs_auth_app`, `AUTH_DB_PASSWORD`, `MEETING_DB_USER=qs_meeting_app`, and `MEETING_DB_PASSWORD` in the production environment. Keep `POSTGRES_USER` and `POSTGRES_PASSWORD` available only to database administration and migration jobs.
4. Recreate the `auth` and `meeting` containers. Verify their health checks and then test both authorized tenant access and cross-tenant denial with those exact application credentials.

The signaling, SFU, and recording containers do not receive PostgreSQL credentials in the production Compose profile. Run migrations separately with an administrator or migration-only role; never put that credential in an application container.

The auth service still performs account lookup across tenants during sign-in, so the `users` table's auth-service policy is intentionally broader than the meeting-service policy. A strict per-tenant boundary for Auth requires moving pre-tenant identity lookup into a narrowly scoped database function and testing all auth queries before narrowing that policy further.
