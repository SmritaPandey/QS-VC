CREATE TABLE platform_installer_downloads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    platform text NOT NULL CHECK (platform IN ('windows', 'macos-arm64', 'macos-x64', 'linux-x64')),
    downloaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform_desktop_activations (
    activation_date date NOT NULL,
    platform text NOT NULL CHECK (platform IN ('win32', 'darwin', 'linux')),
    architecture text NOT NULL CHECK (architecture IN ('x64', 'arm64')),
    app_version varchar(40) NOT NULL,
    activation_count bigint NOT NULL DEFAULT 1 CHECK (activation_count > 0),
    PRIMARY KEY (activation_date, platform, architecture, app_version)
);

CREATE TABLE platform_financial_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_type text NOT NULL CHECK (entry_type IN ('revenue', 'expense')),
    category varchar(80) NOT NULL,
    amount numeric(16, 2) NOT NULL CHECK (amount > 0),
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    description varchar(500) NOT NULL,
    occurred_on date NOT NULL,
    recorded_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX platform_installer_downloads_date_idx ON platform_installer_downloads (downloaded_at);
CREATE INDEX platform_desktop_activations_date_idx ON platform_desktop_activations (activation_date);
CREATE INDEX platform_financial_entries_date_idx ON platform_financial_entries (occurred_on, currency);

CREATE FUNCTION qsvc_record_installer_download(p_platform text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    INSERT INTO public.platform_installer_downloads(platform) VALUES (p_platform)
$$;

CREATE FUNCTION qsvc_record_desktop_activation(p_platform text, p_architecture text, p_app_version text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    INSERT INTO public.platform_desktop_activations(activation_date, platform, architecture, app_version)
    VALUES ((now() AT TIME ZONE 'UTC')::date, p_platform, p_architecture, p_app_version)
    ON CONFLICT (activation_date, platform, architecture, app_version)
    DO UPDATE SET activation_count = platform_desktop_activations.activation_count + 1
$$;

CREATE FUNCTION qsvc_add_platform_financial_entry(
    p_recorded_by uuid,
    p_entry_type text,
    p_category text,
    p_amount numeric,
    p_currency text,
    p_occurred_on date,
    p_description text
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    INSERT INTO public.platform_financial_entries
        (recorded_by, entry_type, category, amount, currency, occurred_on, description)
    VALUES
        (p_recorded_by, p_entry_type, p_category, p_amount, p_currency, p_occurred_on, p_description)
    RETURNING id
$$;

CREATE FUNCTION qsvc_platform_admin_analytics(p_quarters integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    summary jsonb;
BEGIN
    IF p_quarters < 1 OR p_quarters > 12 THEN
        RAISE EXCEPTION 'quarters must be between 1 and 12';
    END IF;

    WITH periods AS (
        SELECT generate_series(
            date_trunc('quarter', now() AT TIME ZONE 'UTC') - (p_quarters - 1) * interval '3 months',
            date_trunc('quarter', now() AT TIME ZONE 'UTC'),
            interval '3 months'
        ) AS period
    ), meetings_by_period AS (
        SELECT p.period, count(m.id)::bigint AS meetings_created
        FROM periods p
        LEFT JOIN public.meetings m
            ON m.created_at >= (p.period AT TIME ZONE 'UTC')
            AND m.created_at < ((p.period + interval '3 months') AT TIME ZONE 'UTC')
        GROUP BY p.period
    ), access_by_period AS (
        SELECT p.period, count(t.user_id)::bigint AS access_terms_updated
        FROM periods p
        LEFT JOIN public.enterprise_access_terms t
            ON t.updated_at >= (p.period AT TIME ZONE 'UTC')
            AND t.updated_at < ((p.period + interval '3 months') AT TIME ZONE 'UTC')
        GROUP BY p.period
    ), downloads_by_period AS (
        SELECT p.period, count(d.id)::bigint AS downloads
        FROM periods p
        LEFT JOIN public.platform_installer_downloads d
            ON d.downloaded_at >= (p.period AT TIME ZONE 'UTC')
            AND d.downloaded_at < ((p.period + interval '3 months') AT TIME ZONE 'UTC')
        GROUP BY p.period
    ), activations_by_period AS (
        SELECT p.period, COALESCE(sum(a.activation_count), 0)::bigint AS activations
        FROM periods p
        LEFT JOIN public.platform_desktop_activations a
            ON a.activation_date >= p.period::date
            AND a.activation_date < (p.period + interval '3 months')::date
        GROUP BY p.period
    ), finance_by_period AS (
        SELECT p.period, f.currency,
            COALESCE(sum(f.amount) FILTER (WHERE f.entry_type = 'revenue'), 0)::numeric(16, 2) AS revenue,
            COALESCE(sum(f.amount) FILTER (WHERE f.entry_type = 'expense'), 0)::numeric(16, 2) AS expenses
        FROM periods p
        LEFT JOIN public.platform_financial_entries f
            ON f.occurred_on >= p.period::date
            AND f.occurred_on < (p.period + interval '3 months')::date
        GROUP BY p.period, f.currency
    ), plan_totals AS (
        SELECT plan, count(*)::bigint AS organisations,
            count(*) FILTER (WHERE is_active)::bigint AS active_organisations
        FROM public.tenants
        GROUP BY plan
    ), financial_totals AS (
        SELECT currency,
            COALESCE(sum(amount) FILTER (WHERE entry_type = 'revenue'), 0)::numeric(16, 2) AS revenue,
            COALESCE(sum(amount) FILTER (WHERE entry_type = 'expense'), 0)::numeric(16, 2) AS expenses
        FROM public.platform_financial_entries
        GROUP BY currency
    ), installer_totals AS (
        SELECT platforms.platform,
            count(downloads.id)::bigint AS count
        FROM (VALUES ('windows'), ('macos-arm64'), ('macos-x64'), ('linux-x64')) AS platforms(platform)
        LEFT JOIN public.platform_installer_downloads downloads USING (platform)
        GROUP BY platforms.platform
    ), activation_totals AS (
        SELECT platform, architecture, sum(activation_count)::bigint AS count
        FROM public.platform_desktop_activations
        GROUP BY platform, architecture
    ), meeting_status_totals AS (
        SELECT status, count(*)::bigint AS count
        FROM public.meetings
        GROUP BY status
    ), recent_entries AS (
        SELECT e.id, e.entry_type, e.category, e.amount::text AS amount,
            e.currency, e.description, e.occurred_on, e.created_at,
            COALESCE(u.display_name, 'Platform admin') AS recorded_by
        FROM public.platform_financial_entries e
        LEFT JOIN public.users u ON u.id = e.recorded_by
        ORDER BY e.created_at DESC
        LIMIT 20
    )
    SELECT jsonb_build_object(
        'generatedAt', now(),
        'totals', jsonb_build_object(
            'organisations', (SELECT count(*) FROM public.tenants),
            'activeOrganisations', (SELECT count(*) FROM public.tenants WHERE is_active),
            'activeUsers', (SELECT count(*) FROM public.users WHERE is_active),
            'meetingsCreated', (SELECT count(*) FROM public.meetings),
            'scheduledMeetings', (SELECT count(*) FROM public.meetings WHERE scheduled_start IS NOT NULL),
            'activeMeetingRecords', (SELECT count(*) FROM public.meetings WHERE status = 'active'),
            'endedMeetings', (SELECT count(*) FROM public.meetings WHERE status IN ('ended', 'completed')),
            'cancelledMeetings', (SELECT count(*) FROM public.meetings WHERE status = 'cancelled'),
            'recurringMeetingRecords', (SELECT count(*) FROM public.meetings WHERE type = 'recurring'),
            'webinars', (SELECT count(*) FROM public.meetings WHERE settings->>'webinar' = 'true'),
            'enterpriseAccessSeats', (SELECT count(*) FROM public.enterprise_access_terms),
            'activeEnterpriseAccessSeats', (SELECT count(*) FROM public.enterprise_access_terms WHERE expires_at > now()),
            'installerDownloads', (SELECT count(*) FROM public.platform_installer_downloads),
            'desktopAppActivations', (SELECT COALESCE(sum(activation_count), 0) FROM public.platform_desktop_activations)
        ),
        'plans', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'plan', plan, 'organisations', organisations, 'activeOrganisations', active_organisations
            ) ORDER BY plan) FROM plan_totals
        ), '[]'::jsonb),
        'meetingStatuses', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('status', status, 'count', count) ORDER BY status)
            FROM meeting_status_totals
        ), '[]'::jsonb),
        'installerDownloadsByPlatform', COALESCE((
            SELECT jsonb_object_agg(platform, count ORDER BY platform) FROM installer_totals
        ), '{}'::jsonb),
        'desktopActivationsByPlatform', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('platform', platform, 'architecture', architecture, 'count', count)
                ORDER BY platform, architecture) FROM activation_totals
        ), '[]'::jsonb),
        'quarters', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'quarter', to_char(m.period, 'YYYY "Q"Q'),
                'meetingsCreated', m.meetings_created,
                'accessTermsUpdated', a.access_terms_updated,
                'installerDownloads', d.downloads,
                'desktopAppActivations', i.activations,
                'financials', COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                        'currency', f.currency,
                        'revenue', f.revenue::text,
                        'expenses', f.expenses::text,
                        'net', (f.revenue - f.expenses)::text
                    ) ORDER BY f.currency)
                    FROM finance_by_period f WHERE f.period = m.period AND f.currency IS NOT NULL
                ), '[]'::jsonb)
            ) ORDER BY m.period)
            FROM meetings_by_period m
            JOIN access_by_period a USING (period)
            JOIN downloads_by_period d USING (period)
            JOIN activations_by_period i USING (period)
        ), '[]'::jsonb),
        'financialTotalsByCurrency', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'currency', currency,
                'revenue', revenue::text,
                'expenses', expenses::text,
                'net', (revenue - expenses)::text
            ) ORDER BY currency) FROM financial_totals
        ), '[]'::jsonb),
        'recentFinancialEntries', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', id, 'type', entry_type, 'category', category,
                'amount', amount, 'currency', currency, 'description', description,
                'occurredOn', occurred_on, 'createdAt', created_at, 'recordedBy', recorded_by
            ) ORDER BY created_at DESC) FROM recent_entries
        ), '[]'::jsonb)
    ) INTO summary;

    RETURN summary;
END;
$$;

REVOKE ALL ON TABLE platform_installer_downloads, platform_desktop_activations, platform_financial_entries FROM PUBLIC, qsvc_auth_service, qsvc_meeting_service;
REVOKE ALL ON FUNCTION qsvc_record_installer_download(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION qsvc_record_desktop_activation(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION qsvc_add_platform_financial_entry(uuid, text, text, numeric, text, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION qsvc_platform_admin_analytics(integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION qsvc_record_installer_download(text) TO qsvc_auth_service;
GRANT EXECUTE ON FUNCTION qsvc_record_desktop_activation(text, text, text) TO qsvc_auth_service;
GRANT EXECUTE ON FUNCTION qsvc_add_platform_financial_entry(uuid, text, text, numeric, text, date, text) TO qsvc_auth_service;
GRANT EXECUTE ON FUNCTION qsvc_platform_admin_analytics(integer) TO qsvc_auth_service;
