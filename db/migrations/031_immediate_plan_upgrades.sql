-- Keep the current plan active while one explicitly approved upgrade is pending.
ALTER TABLE public.users
    ALTER COLUMN subscription_plan DROP DEFAULT,
    ALTER COLUMN trial_started_at DROP DEFAULT,
    ALTER COLUMN trial_ends_at DROP DEFAULT;

ALTER TABLE public.payment_subscriptions
    ADD CONSTRAINT payment_subscription_owner_key UNIQUE (id, tenant_id, user_id),
    ADD COLUMN replaces_subscription_id UUID,
    ADD COLUMN superseded_by_subscription_id UUID,
    ADD CONSTRAINT subscription_upgrade_owner FOREIGN KEY (replaces_subscription_id, tenant_id, user_id)
        REFERENCES public.payment_subscriptions (id, tenant_id, user_id),
    ADD CONSTRAINT subscription_successor_owner FOREIGN KEY (superseded_by_subscription_id, tenant_id, user_id)
        REFERENCES public.payment_subscriptions (id, tenant_id, user_id),
    ADD CONSTRAINT subscription_upgrade_not_self CHECK (replaces_subscription_id IS DISTINCT FROM id
        AND superseded_by_subscription_id IS DISTINCT FROM id);

DROP INDEX public.payment_subscriptions_one_open_per_user_idx;
CREATE UNIQUE INDEX payment_subscriptions_one_current_per_user_idx
    ON public.payment_subscriptions (tenant_id, user_id) WHERE status IN ('active', 'past_due');
CREATE UNIQUE INDEX payment_subscriptions_one_checkout_per_user_idx
    ON public.payment_subscriptions (tenant_id, user_id) WHERE status IN ('creating', 'pending');
