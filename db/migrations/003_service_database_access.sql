-- Non-login privilege groups. Provision separate login credentials privately.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qsvc_auth_service') THEN
        CREATE ROLE qsvc_auth_service NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qsvc_meeting_service') THEN
        CREATE ROLE qsvc_meeting_service NOLOGIN;
    END IF;
END $$;
GRANT qsvc_auth_service, qsvc_meeting_service TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO qsvc_auth_service, qsvc_meeting_service;
GRANT SELECT ON tenants TO qsvc_auth_service;
GRANT SELECT, INSERT, UPDATE ON users TO qsvc_auth_service;
GRANT INSERT ON contact_enquiries TO qsvc_auth_service;
GRANT SELECT (id) ON contact_enquiries TO qsvc_auth_service;
GRANT SELECT, INSERT, UPDATE ON meetings TO qsvc_meeting_service;
GRANT SELECT (id, tenant_id, display_name) ON users TO qsvc_meeting_service;

-- Authentication must find a user before their tenant is known. Only the auth
-- service receives this policy, never the meeting service or public DB roles.
CREATE POLICY auth_service_users ON users TO qsvc_auth_service USING (true) WITH CHECK (true);
ALTER POLICY tenant_isolation_users ON users USING
    (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID);
ALTER POLICY tenant_isolation_meetings ON meetings USING
    (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID);
ALTER POLICY tenant_isolation_recordings ON recordings USING
    (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID);

-- A join link can reveal these meeting preview fields without an authenticated
-- tenant. Keep the capability limited to a code lookup; never return account data.
CREATE FUNCTION public.qsvc_meeting_by_code(code text)
RETURNS TABLE (id uuid, meeting_code varchar, title varchar, host_id uuid,
    host_name varchar, type varchar, status varchar, scheduled_start timestamptz,
    scheduled_end timestamptz, settings jsonb, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT m.id, m.meeting_code, m.title, m.host_id, u.display_name,
    m.type, m.status, m.scheduled_start, m.scheduled_end, m.settings, m.created_at
    FROM public.meetings m LEFT JOIN public.users u ON u.id = m.host_id
    WHERE m.meeting_code = upper(code) $$;
REVOKE ALL ON FUNCTION public.qsvc_meeting_by_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qsvc_meeting_by_code(text) TO qsvc_meeting_service;

-- Remove the known development login; never leave it active after a fresh migration.
UPDATE users SET is_active = false, preferences = preferences - '_authSessionId'
WHERE id = '00000000-0000-0000-0000-000000000010'
  AND email = 'admin@qsvc.dev' AND password_hash = crypt('admin123', password_hash);
