\set ON_ERROR_STOP on
-- Operator-only, one-time account provisioning. Password entry is private in psql.
-- Deliberately fail if accounts already exist; do not silently rotate live credentials.
CREATE ROLE qs_auth_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT CONNECTION LIMIT 10;
CREATE ROLE qs_meeting_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT CONNECTION LIMIT 10;
GRANT qsvc_auth_service TO qs_auth_app;
GRANT qsvc_meeting_service TO qs_meeting_app;
\password qs_auth_app
\password qs_meeting_app
ALTER ROLE qs_auth_app LOGIN;
ALTER ROLE qs_meeting_app LOGIN;
SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
FROM pg_roles WHERE rolname IN ('qs_auth_app','qs_meeting_app') ORDER BY rolname;
