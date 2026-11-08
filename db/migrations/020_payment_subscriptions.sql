ALTER TABLE public.users
    ADD COLUMN subscription_expires_at TIMESTAMPTZ;

CREATE TABLE public.payment_subscriptions (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    provider VARCHAR(16) NOT NULL CHECK (provider IN ('razorpay', 'paypal')),
    plan VARCHAR(16) NOT NULL CHECK (plan IN ('starter', 'pro')),
    provider_plan_id TEXT NOT NULL,
    provider_subscription_id TEXT,
    approval_url TEXT,
    currency VARCHAR(3) NOT NULL CHECK (currency = upper(currency)),
    base_amount NUMERIC(18, 6) NOT NULL CHECK (base_amount >= 0),
    tax_percent NUMERIC(5, 2) NOT NULL CHECK (tax_percent = 18),
    tax_amount NUMERIC(18, 6) NOT NULL CHECK (tax_amount >= 0),
    total_amount NUMERIC(18, 6) NOT NULL CHECK (total_amount = base_amount + tax_amount),
    status VARCHAR(16) NOT NULL CHECK (status IN ('creating', 'pending', 'active', 'past_due', 'cancelled', 'expired', 'failed')),
    current_period_end TIMESTAMPTZ,
    checkout_expires_at TIMESTAMPTZ NOT NULL,
    last_provider_payment_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, provider_subscription_id)
);

CREATE INDEX payment_subscriptions_tenant_user_created_idx
    ON public.payment_subscriptions (tenant_id, user_id, created_at DESC);
CREATE UNIQUE INDEX payment_subscriptions_one_open_per_user_idx
    ON public.payment_subscriptions (tenant_id, user_id)
    WHERE status IN ('creating', 'pending', 'active', 'past_due');

ALTER TABLE public.payment_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY payment_subscriptions_auth_tenant ON public.payment_subscriptions
    TO qsvc_auth_service
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID);
GRANT SELECT, INSERT, UPDATE ON public.payment_subscriptions TO qsvc_auth_service;

CREATE TABLE public.payment_webhook_events (
    provider VARCHAR(16) NOT NULL CHECK (provider IN ('razorpay', 'paypal')),
    event_id VARCHAR(255) NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    payload_sha256 CHAR(64) NOT NULL,
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
    result VARCHAR(16) NOT NULL DEFAULT 'received' CHECK (result IN ('received', 'processed', 'ignored')),
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    PRIMARY KEY (provider, event_id)
);
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhook_events FORCE ROW LEVEL SECURITY;
CREATE POLICY payment_webhook_events_auth_service ON public.payment_webhook_events
    TO qsvc_auth_service USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON public.payment_webhook_events TO qsvc_auth_service;

-- Webhooks arrive without a tenant context. This function exposes only the
-- local subscription mapping for one provider-issued subscription identifier.
CREATE FUNCTION public.qsvc_payment_subscription_context(p_provider TEXT, p_provider_subscription_id TEXT)
RETURNS TABLE (
    id UUID, tenant_id UUID, user_id UUID, plan VARCHAR, provider_plan_id TEXT,
    status VARCHAR, current_period_end TIMESTAMPTZ, currency VARCHAR,
    base_amount NUMERIC, tax_percent NUMERIC, tax_amount NUMERIC, total_amount NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
    SELECT s.id, s.tenant_id, s.user_id, s.plan, s.provider_plan_id, s.status,
           s.current_period_end, s.currency, s.base_amount, s.tax_percent, s.tax_amount, s.total_amount
    FROM public.payment_subscriptions s
    WHERE s.provider = p_provider AND s.provider_subscription_id = p_provider_subscription_id
    LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.qsvc_payment_subscription_context(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qsvc_payment_subscription_context(TEXT, TEXT) TO qsvc_auth_service;
