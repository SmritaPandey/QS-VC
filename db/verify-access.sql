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
INSERT INTO room_numbers(number,tenant_id,meeting_code,display_name) VALUES
 ('9901','aaaaaaaa-0000-0000-0000-000000000001','DB-CHECK-A','Synthetic room A'),
 ('9902','bbbbbbbb-0000-0000-0000-000000000001','DB-CHECK-B','Synthetic room B');
INSERT INTO room_devices(tenant_id,name,extension) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','Synthetic device A','9903'),
 ('bbbbbbbb-0000-0000-0000-000000000001','Synthetic device B','9904');
INSERT INTO users(id,tenant_id,email,display_name) VALUES
 ('bbbbbbbb-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000001','db-check@tenant-b.example','Synthetic SSO test B');
INSERT INTO payment_subscriptions(id,tenant_id,user_id,provider,plan,provider_plan_id,provider_subscription_id,
 currency,base_amount,tax_percent,tax_amount,total_amount,status,checkout_expires_at) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002',
  'razorpay','starter','test-plan','test-sub-a','INR',100,18,18,118,'failed',now()),
 ('bbbbbbbb-0000-0000-0000-000000000005','bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002',
  'razorpay','starter','test-plan','test-sub-b','INR',100,18,18,118,'failed',now());
INSERT INTO payment_mandate_cancellations(subscription_id,tenant_id) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000001'),
 ('bbbbbbbb-0000-0000-0000-000000000005','bbbbbbbb-0000-0000-0000-000000000001');
SET LOCAL ROLE qsvc_auth_service;
SELECT set_config('app.current_tenant','aaaaaaaa-0000-0000-0000-000000000001',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM payment_mandate_cancellations) <> 1 THEN RAISE EXCEPTION 'Cancellation queue tenant isolation failed'; END IF;
 UPDATE payment_mandate_cancellations SET completed_at = now() WHERE tenant_id = 'bbbbbbbb-0000-0000-0000-000000000001';
 IF FOUND THEN RAISE EXCEPTION 'Cross-tenant cancellation update succeeded'; END IF;
 BEGIN
  INSERT INTO payment_mandate_cancellations(subscription_id,tenant_id) VALUES
   ('aaaaaaaa-0000-0000-0000-000000000005','bbbbbbbb-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'Cross-tenant cancellation insert succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.payment_mandate_cancellations'::regclass)
 THEN RAISE EXCEPTION 'Cancellation queue does not force RLS'; END IF;
 IF (SELECT count(*) FROM qsvc_claim_mandate_cancellations()) <> 2 THEN RAISE EXCEPTION 'Cancellation claim failed'; END IF;
 IF EXISTS(SELECT 1 FROM qsvc_claim_mandate_cancellations()) THEN RAISE EXCEPTION 'Cancellation lease was replayed'; END IF;
END $$;
INSERT INTO sso_connections(id, tenant_id, domain, dns_token, provider, verified_at, tested_at, enforce_sso) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000001','tenant-a.example','test-a','oidc',now(),now(),true);
INSERT INTO user_identities(tenant_id,user_id,connection_id,provider,subject) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000004','keycloak','test-a');
INSERT INTO user_identities(tenant_id,user_id,provider,subject) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002','google','personal-test-a');
SELECT set_config('app.current_tenant','bbbbbbbb-0000-0000-0000-000000000001',true);
INSERT INTO sso_connections(id, tenant_id, domain, dns_token, provider) VALUES
 ('bbbbbbbb-0000-0000-0000-000000000004','bbbbbbbb-0000-0000-0000-000000000001','tenant-b.example','test-b','oidc');
INSERT INTO user_identities(tenant_id,user_id,connection_id,provider,subject) VALUES
 ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000004','keycloak','test-b');
INSERT INTO user_identities(tenant_id,user_id,provider,subject) VALUES
 ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','microsoft','personal-test-b');
DO $$ BEGIN
 IF (SELECT count(*) FROM sso_connections) <> 1 OR (SELECT count(*) FROM user_identities) <> 2 THEN RAISE EXCEPTION 'SSO tenant isolation failed'; END IF;
 BEGIN
  INSERT INTO user_identities(tenant_id,user_id,connection_id,provider,subject) VALUES
   ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000004','keycloak','invalid-user');
  RAISE EXCEPTION 'Cross-tenant identity reference was allowed';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO user_identities(tenant_id,user_id,provider,subject) VALUES
   ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','microsoft','another-personal-test-b');
  RAISE EXCEPTION 'A personal account accepted two identities from the same provider';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO sso_connections(tenant_id,domain,dns_token) VALUES
   ('aaaaaaaa-0000-0000-0000-000000000001','foreign.example','forbidden');
  RAISE EXCEPTION 'Cross-tenant SSO insert was allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
SELECT set_config('app.current_tenant','',true);
SELECT set_config('app.sso_domain','tenant-b.example',true);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM sso_connections) OR EXISTS (SELECT 1 FROM user_identities) THEN RAISE EXCEPTION 'Unverified SSO domain is discoverable'; END IF;
END $$;
SELECT set_config('app.sso_domain','tenant-a.example',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM sso_connections) <> 1 THEN RAISE EXCEPTION 'Verified SSO domain is not discoverable'; END IF;
 UPDATE sso_connections SET enforce_sso = false WHERE domain = 'tenant-a.example';
 IF FOUND THEN RAISE EXCEPTION 'Discovery can update SSO settings'; END IF;
 IF (SELECT count(*) FROM pg_class WHERE oid IN ('sso_connections'::regclass, 'user_identities'::regclass)
     AND relrowsecurity AND relforcerowsecurity) <> 2 THEN RAISE EXCEPTION 'SSO tables must force RLS'; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qs_auth_app') AND EXISTS (
     SELECT 1 FROM (VALUES ('public.sso_connections'), ('public.user_identities')) t(name)
     CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE')) p(privilege)
     WHERE NOT has_table_privilege('qs_auth_app', t.name, p.privilege)) THEN
    RAISE EXCEPTION 'SSO grants did not reach qs_auth_app';
 END IF;
END $$;
SELECT set_config('app.sso_domain','',true);
SELECT set_config('app.sso_challenge','sso-qa-code',true);
INSERT INTO sso_challenges(key_hash, kind, payload) VALUES ('sso-qa-code','exchange','{"binding":"right-verifier"}');
DO $$ BEGIN
 DELETE FROM sso_challenges WHERE key_hash = 'sso-qa-code' AND payload->>'binding' = 'wrong-verifier' AND expires_at > now();
 IF FOUND THEN RAISE EXCEPTION 'Wrong verifier consumed the SSO code'; END IF;
 DELETE FROM sso_challenges WHERE key_hash = 'sso-qa-code' AND payload->>'binding' = 'right-verifier' AND expires_at > now();
 IF NOT FOUND THEN RAISE EXCEPTION 'Valid SSO code could not be consumed'; END IF;
 DELETE FROM sso_challenges WHERE key_hash = 'sso-qa-code' AND payload->>'binding' = 'right-verifier' AND expires_at > now();
 IF FOUND THEN RAISE EXCEPTION 'SSO code was replayed'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE qsvc_auth_service;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM users WHERE email='db-check@example.test' AND password_hash=crypt('synthetic-test-only',password_hash)) THEN RAISE EXCEPTION 'Authentication lookup failed'; END IF;
 IF has_table_privilege(current_user,'public.meetings','SELECT') OR has_schema_privilege(current_user,'public','CREATE') THEN RAISE EXCEPTION 'Auth service has excessive privileges'; END IF;
 IF has_table_privilege(current_user,'public.platform_financial_entries','SELECT') OR has_table_privilege(current_user,'public.platform_financial_entries','INSERT') THEN RAISE EXCEPTION 'Auth service can access the financial ledger directly'; END IF;
 IF NOT has_function_privilege(current_user,'public.qsvc_platform_admin_analytics(integer)','EXECUTE') OR NOT has_function_privilege(current_user,'public.qsvc_add_platform_financial_entry(uuid,text,text,numeric,text,date,text)','EXECUTE') THEN RAISE EXCEPTION 'Platform analytics functions are not granted to the auth service'; END IF;
END $$;
SELECT public.qsvc_record_desktop_activation('win32','x64','0.0.0-test');
SELECT public.qsvc_record_installer_download('windows');
SELECT public.qsvc_add_platform_financial_entry('aaaaaaaa-0000-0000-0000-000000000002','revenue','test','1.00','INR','2026-01-01','Synthetic DB privilege check');
DO $$ BEGIN
 IF public.qsvc_platform_admin_analytics(4)->'totals'->>'desktopAppActivations' IS NULL THEN RAISE EXCEPTION 'Platform analytics did not return aggregate metrics'; END IF;
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
 IF (SELECT count(*) FROM room_numbers WHERE number IN ('9901','9902')) <> 1 THEN RAISE EXCEPTION 'Room-number tenant isolation failed'; END IF;
 IF (SELECT count(*) FROM room_devices WHERE extension IN ('9903','9904')) <> 1 THEN RAISE EXCEPTION 'Room-device tenant isolation failed'; END IF;
 IF has_table_privilege(current_user,'public.users','UPDATE') OR has_schema_privilege(current_user,'public','CREATE') THEN RAISE EXCEPTION 'Meeting service has excessive privileges'; END IF;
 IF (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'Meeting service role can bypass row-level security'; END IF;
END $$;
SELECT set_config('app.current_tenant','',true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM meetings) THEN RAISE EXCEPTION 'Unscoped tenant read succeeded'; END IF;
 IF EXISTS(SELECT 1 FROM room_numbers) OR EXISTS(SELECT 1 FROM room_devices) THEN RAISE EXCEPTION 'Unscoped room-registry read succeeded'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.qsvc_meeting_by_code('DB-CHECK-A')) THEN RAISE EXCEPTION 'Join code preview failed'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: SQL persistence, auth/session operations, service privileges and tenant isolation; synthetic writes rolled back' AS result;
