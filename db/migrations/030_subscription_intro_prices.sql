-- Existing subscriptions keep their agreed prices. Only new checkouts opt into an offer.
ALTER TABLE public.payment_subscriptions
    ADD COLUMN intro_cycles SMALLINT NOT NULL DEFAULT 0 CHECK (intro_cycles BETWEEN 0 AND 12),
    ADD COLUMN intro_total_amount NUMERIC,
    ADD COLUMN regular_base_amount NUMERIC,
    ADD COLUMN regular_tax_amount NUMERIC,
    ADD COLUMN regular_total_amount NUMERIC,
    ADD COLUMN regular_provider_plan_id TEXT,
    ADD COLUMN price_transition_attempt_at TIMESTAMPTZ,
    ADD COLUMN price_transition_completed_at TIMESTAMPTZ,
    ADD CONSTRAINT subscription_intro_snapshot CHECK (intro_cycles = 0 OR (
        provider = 'cashfree' AND regular_base_amount IS NOT NULL AND regular_tax_amount IS NOT NULL
        AND regular_total_amount IS NOT NULL AND intro_total_amount IS NOT NULL
        AND intro_total_amount > 0 AND intro_total_amount <= regular_total_amount
        AND regular_base_amount > 0 AND regular_tax_amount >= 0
        AND regular_total_amount = regular_base_amount + regular_tax_amount
        AND regular_total_amount >= total_amount AND regular_provider_plan_id IS NOT NULL
    ));

DROP FUNCTION public.qsvc_payment_subscription_context(TEXT, TEXT);
CREATE FUNCTION public.qsvc_payment_subscription_context(p_provider TEXT, p_provider_subscription_id TEXT)
RETURNS TABLE (
    id UUID, tenant_id UUID, user_id UUID, plan VARCHAR, provider_plan_id TEXT,
    status VARCHAR, current_period_end TIMESTAMPTZ, currency VARCHAR,
    base_amount NUMERIC, tax_percent NUMERIC, tax_amount NUMERIC, total_amount NUMERIC,
    trial_checkout BOOLEAN, trial_ends_at TIMESTAMPTZ, trial_days SMALLINT, billing_period VARCHAR,
    intro_cycles SMALLINT, intro_total_amount NUMERIC, regular_base_amount NUMERIC, regular_tax_amount NUMERIC,
    regular_total_amount NUMERIC, regular_provider_plan_id TEXT, price_transition_completed_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT s.id, s.tenant_id, s.user_id, s.plan, s.provider_plan_id, s.status,
           s.current_period_end, s.currency, s.base_amount, s.tax_percent,
           s.tax_amount, s.total_amount, s.trial_checkout, s.trial_ends_at, s.trial_days, s.billing_period,
           s.intro_cycles, s.intro_total_amount, s.regular_base_amount, s.regular_tax_amount, s.regular_total_amount,
           s.regular_provider_plan_id, s.price_transition_completed_at
    FROM public.payment_subscriptions s
    WHERE s.provider = p_provider AND s.provider_subscription_id = p_provider_subscription_id LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.qsvc_payment_subscription_context(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qsvc_payment_subscription_context(TEXT, TEXT) TO qsvc_auth_service;

CREATE POLICY intro_capture_migration_read ON public.payment_captures TO CURRENT_USER USING (true);
CREATE POLICY intro_transition_migration_update ON public.payment_subscriptions FOR UPDATE TO CURRENT_USER
    USING (provider = 'cashfree' AND intro_cycles > 0) WITH CHECK (provider = 'cashfree' AND intro_cycles > 0);
-- The definer can claim a bounded job list; application roles retain tenant RLS.
CREATE FUNCTION public.qsvc_claim_intro_transitions()
RETURNS TABLE (id UUID, tenant_id UUID, provider_subscription_id TEXT, provider_plan_id TEXT,
    currency VARCHAR, total_amount NUMERIC, billing_period VARCHAR, intro_cycles SMALLINT,
    regular_base_amount NUMERIC, regular_tax_amount NUMERIC, regular_total_amount NUMERIC, regular_provider_plan_id TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    WITH due AS (
        SELECT s.id FROM public.payment_subscriptions s
        WHERE s.provider = 'cashfree' AND s.intro_cycles > 0 AND s.price_transition_completed_at IS NULL
          AND s.status = 'active' AND s.provider_subscription_id IS NOT NULL
          AND (s.price_transition_attempt_at IS NULL OR s.price_transition_attempt_at < NOW() - INTERVAL '5 minutes')
          AND (SELECT count(*) FROM public.payment_captures c WHERE c.subscription_id = s.id AND NOT c.needs_review) >= s.intro_cycles
        ORDER BY s.created_at LIMIT 10 FOR UPDATE SKIP LOCKED
    )
    UPDATE public.payment_subscriptions s SET price_transition_attempt_at = NOW()
    FROM due WHERE s.id = due.id RETURNING s.id, s.tenant_id, s.provider_subscription_id, s.provider_plan_id,
        s.currency, s.total_amount, s.billing_period, s.intro_cycles,
        s.regular_base_amount, s.regular_tax_amount, s.regular_total_amount, s.regular_provider_plan_id
$$;
REVOKE ALL ON FUNCTION public.qsvc_claim_intro_transitions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qsvc_claim_intro_transitions() TO qsvc_auth_service;
