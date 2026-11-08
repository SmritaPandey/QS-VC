ALTER TABLE public.payment_subscriptions
    ADD COLUMN billing_mode VARCHAR(16) NOT NULL DEFAULT 'subscription'
        CHECK (billing_mode IN ('subscription', 'one_time')),
    ADD COLUMN provider_order_id TEXT;

CREATE UNIQUE INDEX payment_subscriptions_razorpay_order_idx
    ON public.payment_subscriptions (provider_order_id)
    WHERE provider = 'razorpay' AND provider_order_id IS NOT NULL;
