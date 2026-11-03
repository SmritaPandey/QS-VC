\set ON_ERROR_STOP on
BEGIN;
INSERT INTO tenants(id, name, slug) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','Synthetic DB test A','db-check-a'),
 ('bbbbbbbb-0000-0000-0000-000000000001','Synthetic DB test B','db-check-b');
INSERT INTO users(id,tenant_id,email,display_name,password_hash) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','db-check@example.test','Synthetic DB test',crypt('synthetic-test-only',gen_salt('bf')));
INSERT INTO meetings(tenant_id,meeting_code,title) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','DB-CHECK-A','Synthetic meeting A'),
 ('bbbbbbbb-0000-0000-0000-000000000001','DB-CHECK-B','Synthetic meeting B');
SET LOCAL ROLE qsvc_auth_service;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM users WHERE email='db-check@example.test' AND password_hash=crypt('synthetic-test-only',password_hash)) THEN RAISE EXCEPTION 'Authentication lookup failed'; END IF;
 IF has_table_privilege(current_user,'public.meetings','SELECT') OR has_schema_privilege(current_user,'public','CREATE') THEN RAISE EXCEPTION 'Auth service has excessive privileges'; END IF;
END $$;
UPDATE users SET preferences=jsonb_build_object('_authSessionId','synthetic-session') WHERE email='db-check@example.test';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM users WHERE email='db-check@example.test' AND preferences->>'_authSessionId'='synthetic-session') THEN RAISE EXCEPTION 'Session persistence failed'; END IF;
END $$;
UPDATE users SET preferences=preferences-'_authSessionId' WHERE email='db-check@example.test';
INSERT INTO contact_enquiries(id,name,email,topic,message) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000003','Synthetic DB test','db-check@example.test','support','Synthetic access verification') RETURNING id;
RESET ROLE;
SET LOCAL ROLE qsvc_meeting_service;
SELECT set_config('app.current_tenant','aaaaaaaa-0000-0000-0000-000000000001',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM meetings WHERE meeting_code IN ('DB-CHECK-A','DB-CHECK-B')) <> 1 THEN RAISE EXCEPTION 'Tenant isolation failed'; END IF;
 IF has_table_privilege(current_user,'public.users','UPDATE') OR has_schema_privilege(current_user,'public','CREATE') THEN RAISE EXCEPTION 'Meeting service has excessive privileges'; END IF;
END $$;
SELECT set_config('app.current_tenant','',true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM meetings) THEN RAISE EXCEPTION 'Unscoped tenant read succeeded'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.qsvc_meeting_by_code('DB-CHECK-A')) THEN RAISE EXCEPTION 'Join code preview failed'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: SQL persistence, auth/session operations, service privileges and tenant isolation; synthetic writes rolled back' AS result;
