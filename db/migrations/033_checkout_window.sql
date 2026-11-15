-- Only new checkout attempts opt into the three-minute authorization window.
-- Existing pending mandates may already be approved; never infer otherwise from a missing marker.
ALTER TABLE public.payment_subscriptions
    ADD COLUMN checkout_authorized_at TIMESTAMPTZ,
    ADD COLUMN checkout_window_enforced BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN checkout_reconcile_after TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX payment_subscriptions_checkout_expiry_idx
    ON public.payment_subscriptions (checkout_reconcile_after, checkout_expires_at, id)
    WHERE checkout_window_enforced AND status IN ('creating', 'pending')
      AND checkout_authorized_at IS NULL AND current_period_end IS NULL;

-- The migration owner already has SELECT through payment_cancellation_migration_read (028).
-- Claiming only advances a retry lease, so an unavailable provider cannot starve newer attempts.
-- Financial decisions still require provider reconciliation and user/subscription locks in the worker.
CREATE POLICY checkout_expiry_migration_update ON public.payment_subscriptions FOR UPDATE TO CURRENT_USER
    USING (checkout_window_enforced AND status IN ('creating', 'pending')
        AND checkout_authorized_at IS NULL AND current_period_end IS NULL)
    WITH CHECK (checkout_window_enforced AND status IN ('creating', 'pending')
        AND checkout_authorized_at IS NULL AND current_period_end IS NULL);
CREATE FUNCTION public.qsvc_expired_checkout_candidates()
RETURNS TABLE (
    id UUID,
    tenant_id UUID,
    user_id UUID,
    provider VARCHAR,
    provider_subscription_id TEXT,
    checkout_expires_at TIMESTAMPTZ,
    status VARCHAR
)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    WITH due AS (
        SELECT s.id
        FROM public.payment_subscriptions s
        WHERE s.checkout_window_enforced AND s.status IN ('creating', 'pending')
          AND s.checkout_expires_at <= NOW() AND s.checkout_reconcile_after <= NOW()
          AND s.checkout_authorized_at IS NULL AND s.current_period_end IS NULL
        ORDER BY s.checkout_reconcile_after, s.checkout_expires_at, s.id
        LIMIT 100 FOR UPDATE SKIP LOCKED
    )
    UPDATE public.payment_subscriptions s
    SET checkout_reconcile_after = NOW() + INTERVAL '2 minutes'
    FROM due WHERE s.id = due.id
    RETURNING s.id, s.tenant_id, s.user_id, s.provider, s.provider_subscription_id,
              s.checkout_expires_at, s.status
$$;
REVOKE ALL ON FUNCTION public.qsvc_expired_checkout_candidates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qsvc_expired_checkout_candidates() TO qsvc_auth_service;
