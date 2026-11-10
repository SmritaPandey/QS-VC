\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.tenants(id,name,slug) VALUES
 ('cccccccc-0000-4000-8000-000000000001','Intro QA A','intro-qa-a'),
 ('dddddddd-0000-4000-8000-000000000001','Intro QA B','intro-qa-b');
INSERT INTO public.users(id,tenant_id,email,display_name) VALUES
 ('cccccccc-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000001','intro-a@example.test','Intro QA A'),
 ('dddddddd-0000-4000-8000-000000000002','dddddddd-0000-4000-8000-000000000001','intro-b@example.test','Intro QA B');
INSERT INTO public.payment_subscriptions(id,tenant_id,user_id,provider,plan,provider_plan_id,provider_subscription_id,
 currency,base_amount,tax_percent,tax_amount,total_amount,status,checkout_expires_at,intro_cycles,intro_total_amount,
 regular_base_amount,regular_tax_amount,regular_total_amount,regular_provider_plan_id) VALUES
 ('cccccccc-0000-4000-8000-000000000003','cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000002',
 'cashfree','basic','intro-a','intro-qa-sub-a','INR',57,18,10.26,67.26,'active',now()+interval '1 hour',3,67.26,114,20.52,134.52,'regular-a'),
 ('dddddddd-0000-4000-8000-000000000003','dddddddd-0000-4000-8000-000000000001','dddddddd-0000-4000-8000-000000000002',
 'cashfree','basic','intro-b','intro-qa-sub-b','INR',57,18,10.26,67.26,'active',now()+interval '1 hour',3,67.26,114,20.52,134.52,'regular-b');
INSERT INTO public.payment_captures(provider,provider_payment_id,subscription_id,amount_minor,currency) VALUES
 ('cashfree','intro-qa-a1','cccccccc-0000-4000-8000-000000000003',6726,'INR'),
 ('cashfree','intro-qa-a2','cccccccc-0000-4000-8000-000000000003',6726,'INR'),
 ('cashfree','intro-qa-b1','dddddddd-0000-4000-8000-000000000003',6726,'INR'),
 ('cashfree','intro-qa-b2','dddddddd-0000-4000-8000-000000000003',6726,'INR'),
 ('cashfree','intro-qa-b3','dddddddd-0000-4000-8000-000000000003',6726,'INR');
SET LOCAL ROLE qsvc_auth_service;
SELECT set_config('app.current_tenant','cccccccc-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.payment_subscriptions WHERE provider_subscription_id LIKE 'intro-qa-%') <> 1 THEN
  RAISE EXCEPTION 'Intro subscription tenant isolation failed'; END IF;
 UPDATE public.payment_subscriptions SET regular_total_amount=134.52 WHERE provider_subscription_id='intro-qa-sub-b';
 IF FOUND THEN RAISE EXCEPTION 'Cross-tenant intro modification allowed'; END IF;
 IF (SELECT count(*) FROM public.qsvc_claim_intro_transitions() WHERE provider_subscription_id='intro-qa-sub-b') <> 1 THEN
  RAISE EXCEPTION 'Completed paid cycles were not eligible for the worker'; END IF;
 IF (SELECT count(*) FROM public.qsvc_claim_intro_transitions()) <> 0 THEN
  RAISE EXCEPTION 'Claim lease failed or trial/unfinished cycles advanced the offer'; END IF;
END $$;
INSERT INTO public.payment_captures(provider,provider_payment_id,subscription_id,amount_minor,currency)
 VALUES ('cashfree','intro-qa-a2','cccccccc-0000-4000-8000-000000000003',6726,'INR') ON CONFLICT DO NOTHING;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.qsvc_claim_intro_transitions()) <> 0 THEN
  RAISE EXCEPTION 'Duplicate capture advanced the offer'; END IF;
END $$;
INSERT INTO public.payment_captures(provider,provider_payment_id,subscription_id,amount_minor,currency)
 VALUES ('cashfree','intro-qa-a3','cccccccc-0000-4000-8000-000000000003',6726,'INR');
DO $$ BEGIN
 IF (SELECT count(*) FROM public.qsvc_claim_intro_transitions() WHERE provider_subscription_id='intro-qa-sub-a') <> 1 THEN
  RAISE EXCEPTION 'Final discounted capture did not queue renewal'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.qsvc_payment_subscription_context('cashfree','intro-qa-sub-a')
     WHERE intro_cycles=3 AND regular_total_amount=134.52 AND intro_total_amount=67.26) THEN
  RAISE EXCEPTION 'Webhook context lost the agreed price snapshots'; END IF;
END $$;
SELECT set_config('app.current_tenant','',true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.payment_subscriptions) THEN RAISE EXCEPTION 'Missing tenant exposes subscriptions'; END IF;
 IF (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user) THEN RAISE EXCEPTION 'Auth role bypasses RLS'; END IF;
END $$;
ROLLBACK;
