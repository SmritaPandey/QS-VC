-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 042_meeting_service_users_permissions.sql
-- Grant meeting service permissions to read users email, avatar_url, and is_active for invitations
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qsvc_meeting_service') THEN
        GRANT SELECT (email, avatar_url, is_active) ON public.users TO qsvc_meeting_service;
    END IF;
END $$;
