CREATE TABLE public.payment_captures (
    provider VARCHAR(16) NOT NULL CHECK (provider IN ('razorpay', 'paypal', 'cashfree')),
    provider_payment_id TEXT NOT NULL CHECK (length(btrim(provider_payment_id)) BETWEEN 1 AND 255),
    subscription_id UUID NOT NULL REFERENCES public.payment_subscriptions(id) ON DELETE CASCADE,
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    currency VARCHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (provider, provider_payment_id)
);

CREATE INDEX payment_captures_subscription_idx ON public.payment_captures (subscription_id);

ALTER TABLE public.payment_captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_captures FORCE ROW LEVEL SECURITY;
CREATE POLICY payment_captures_auth_tenant ON public.payment_captures
    TO qsvc_auth_service
    USING (EXISTS (
        SELECT 1 FROM public.payment_subscriptions AS subscription
        WHERE subscription.id = payment_captures.subscription_id
          AND subscription.provider = payment_captures.provider
          AND subscription.tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
    ));
GRANT SELECT, INSERT ON public.payment_captures TO qsvc_auth_service;
