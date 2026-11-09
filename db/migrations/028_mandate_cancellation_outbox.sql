-- Retry provider cancellation even if the webhook process exits after committing.
ALTER TABLE public.payment_captures
    ADD COLUMN needs_review BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN review_reason TEXT;
GRANT UPDATE(needs_review, review_reason) ON public.payment_captures TO qsvc_auth_service;
CREATE TABLE public.payment_mandate_cancellations (
    subscription_id UUID PRIMARY KEY REFERENCES public.payment_subscriptions(id),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.payment_mandate_cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_mandate_cancellations FORCE ROW LEVEL SECURITY;
CREATE POLICY mandate_cancellation_tenant ON public.payment_mandate_cancellations TO qsvc_auth_service
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID AND EXISTS (
        SELECT 1 FROM public.payment_subscriptions s
        WHERE s.id = subscription_id AND s.tenant_id = payment_mandate_cancellations.tenant_id
    ));
GRANT SELECT, INSERT, UPDATE ON public.payment_mandate_cancellations TO qsvc_auth_service;
-- The definer is the migration role, which need not be a superuser/BYPASSRLS role.
-- App logins must never inherit that role. Only the bounded claim function is granted.
CREATE POLICY mandate_cancellation_migration_owner ON public.payment_mandate_cancellations TO CURRENT_USER
    USING (true) WITH CHECK (true);
CREATE POLICY payment_cancellation_migration_read ON public.payment_subscriptions FOR SELECT TO CURRENT_USER USING (true);
CREATE INDEX mandate_cancellation_due ON public.payment_mandate_cancellations(next_attempt_at) WHERE completed_at IS NULL;
INSERT INTO public.payment_mandate_cancellations(subscription_id, tenant_id)
SELECT id, tenant_id FROM public.payment_subscriptions
WHERE status = 'failed' AND billing_mode = 'subscription' AND provider_subscription_id IS NOT NULL;

CREATE FUNCTION public.qsvc_claim_mandate_cancellations()
RETURNS TABLE(subscription_id UUID, tenant_id UUID, provider VARCHAR, provider_subscription_id TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    WITH due AS (
        SELECT c.subscription_id FROM public.payment_mandate_cancellations c
        WHERE c.completed_at IS NULL AND c.next_attempt_at <= NOW()
        ORDER BY c.next_attempt_at LIMIT 10 FOR UPDATE SKIP LOCKED
    ), claimed AS (
        UPDATE public.payment_mandate_cancellations c SET attempts = c.attempts + 1,
            next_attempt_at = NOW() + INTERVAL '10 minutes'
        FROM due WHERE c.subscription_id = due.subscription_id
        RETURNING c.subscription_id, c.tenant_id
    )
    SELECT c.subscription_id, c.tenant_id, s.provider, s.provider_subscription_id
    FROM claimed c JOIN public.payment_subscriptions s ON s.id = c.subscription_id AND s.tenant_id = c.tenant_id;
$$;
REVOKE ALL ON FUNCTION public.qsvc_claim_mandate_cancellations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qsvc_claim_mandate_cancellations() TO qsvc_auth_service;
