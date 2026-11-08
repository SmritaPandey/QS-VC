ALTER TABLE public.users
    ADD COLUMN phone_number VARCHAR(16),
    ADD CONSTRAINT users_phone_number_e164_check
        CHECK (phone_number IS NULL OR phone_number ~ '^\+[1-9][0-9]{7,14}$');

CREATE FUNCTION public.qsvc_platform_admin_user_directory(
    p_limit INTEGER,
    p_offset INTEGER,
    p_search TEXT,
    p_plan TEXT,
    p_role TEXT
)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
    WITH enriched AS (
        SELECT
            u.id,
            u.email,
            u.display_name,
            u.phone_number,
            CASE WHEN u.role = 'admin' THEN 'admin'
                 WHEN u.role = 'guest' THEN 'guest'
                 ELSE 'user' END AS role,
            CASE
                WHEN u.role = 'admin' THEN 'admin'
                WHEN u.subscription_plan = 'starter_trial' AND u.trial_ends_at <= now() THEN 'trial_expired'
                WHEN u.subscription_plan = 'starter_trial' THEN 'starter_trial'
                WHEN u.subscription_plan IN ('starter', 'pro') AND u.subscription_expires_at <= now() THEN 'paid_expired'
                WHEN u.subscription_plan IN ('starter', 'pro') THEN u.subscription_plan
                WHEN u.subscription_plan = 'enterprise' OR lower(t.plan) = 'enterprise' THEN 'enterprise'
                WHEN lower(t.plan) IN ('starter', 'pro') THEN lower(t.plan)
                ELSE 'guest'
            END AS plan,
            CASE
                WHEN u.role = 'admin' THEN 'administrator'
                WHEN u.subscription_plan = 'starter_trial' AND u.trial_ends_at <= now() THEN 'trial_expired'
                WHEN u.subscription_plan = 'starter_trial' THEN 'trial_active'
                WHEN u.subscription_plan IN ('starter', 'pro') AND u.subscription_expires_at <= now() THEN 'paid_expired'
                WHEN u.subscription_plan IN ('starter', 'pro') THEN 'paid_active'
                WHEN u.subscription_plan = 'enterprise' OR lower(t.plan) = 'enterprise' THEN COALESCE(u.enterprise_status, 'enterprise_pending')
                ELSE 'free'
            END AS plan_status,
            u.is_active,
            u.created_at,
            u.last_login_at,
            (SELECT count(*) FROM public.meetings m WHERE m.host_id = u.id) AS meeting_count,
            billing.provider AS billing_provider,
            billing.status AS billing_status,
            billing.current_period_end AS subscription_ends_at,
            billing.total_amount AS billing_amount,
            billing.currency AS billing_currency
        FROM public.users u
        JOIN public.tenants t ON t.id = u.tenant_id
        LEFT JOIN LATERAL (
            SELECT ps.provider, ps.status, ps.current_period_end, ps.total_amount, ps.currency
            FROM public.payment_subscriptions ps
            WHERE ps.tenant_id = u.tenant_id AND ps.user_id = u.id
            ORDER BY ps.created_at DESC
            LIMIT 1
        ) billing ON true
    ),
    filtered AS (
        SELECT * FROM enriched e
        WHERE (NULLIF(p_search, '') IS NULL OR e.email ILIKE '%' || p_search || '%' OR e.display_name ILIKE '%' || p_search || '%' OR COALESCE(e.phone_number, '') ILIKE '%' || p_search || '%')
          AND (p_plan IS NULL OR e.plan = p_plan)
          AND (p_role IS NULL OR e.role = p_role)
    ),
    plan_counts AS (
        SELECT plan, count(*)::BIGINT AS count FROM enriched GROUP BY plan
    )
    SELECT jsonb_build_object(
        'totalUsers', (SELECT count(*)::BIGINT FROM enriched),
        'total', (SELECT count(*)::BIGINT FROM filtered),
        'planCounts', COALESCE((SELECT jsonb_object_agg(plan, count) FROM plan_counts), '{}'::JSONB),
        'users', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', page.id,
                'email', page.email,
                'displayName', page.display_name,
                'phoneNumber', page.phone_number,
                'role', page.role,
                'plan', page.plan,
                'planStatus', page.plan_status,
                'billingProvider', page.billing_provider,
                'billingStatus', page.billing_status,
                'subscriptionEndsAt', page.subscription_ends_at,
                'billingAmount', page.billing_amount::TEXT,
                'billingCurrency', page.billing_currency,
                'createdAt', page.created_at,
                'lastLogin', page.last_login_at,
                'meetingCount', page.meeting_count,
                'status', CASE WHEN page.is_active THEN 'active' ELSE 'suspended' END
            ) ORDER BY page.created_at DESC)
            FROM (
                SELECT * FROM filtered
                ORDER BY created_at DESC
                LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100))
                OFFSET GREATEST(COALESCE(p_offset, 0), 0)
            ) page
        ), '[]'::JSONB)
    )
$$;

REVOKE ALL ON FUNCTION public.qsvc_platform_admin_user_directory(INTEGER, INTEGER, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qsvc_platform_admin_user_directory(INTEGER, INTEGER, TEXT, TEXT, TEXT) TO qsvc_auth_service;
