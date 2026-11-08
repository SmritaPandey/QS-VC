ALTER TABLE public.payment_subscriptions
    DROP CONSTRAINT payment_subscriptions_provider_check,
    ADD CONSTRAINT payment_subscriptions_provider_check
        CHECK (provider IN ('razorpay', 'paypal', 'cashfree')),
    ADD COLUMN trial_checkout BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN trial_ends_at TIMESTAMPTZ,
    ADD COLUMN provider_session_id TEXT;

ALTER TABLE public.payment_webhook_events
    DROP CONSTRAINT payment_webhook_events_provider_check,
    ADD CONSTRAINT payment_webhook_events_provider_check
        CHECK (provider IN ('razorpay', 'paypal', 'cashfree'));

DROP FUNCTION public.qsvc_payment_subscription_context(TEXT, TEXT);

CREATE FUNCTION public.qsvc_payment_subscription_context(p_provider TEXT, p_provider_subscription_id TEXT)
RETURNS TABLE (
    id UUID, tenant_id UUID, user_id UUID, plan VARCHAR, provider_plan_id TEXT,
    status VARCHAR, current_period_end TIMESTAMPTZ, currency VARCHAR,
    base_amount NUMERIC, tax_percent NUMERIC, tax_amount NUMERIC, total_amount NUMERIC,
    trial_checkout BOOLEAN, trial_ends_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
    SELECT s.id, s.tenant_id, s.user_id, s.plan, s.provider_plan_id, s.status,
           s.current_period_end, s.currency, s.base_amount, s.tax_percent,
           s.tax_amount, s.total_amount, s.trial_checkout, s.trial_ends_at
    FROM public.payment_subscriptions s
    WHERE s.provider = p_provider AND s.provider_subscription_id = p_provider_subscription_id
    LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.qsvc_payment_subscription_context(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qsvc_payment_subscription_context(TEXT, TEXT) TO qsvc_auth_service;
