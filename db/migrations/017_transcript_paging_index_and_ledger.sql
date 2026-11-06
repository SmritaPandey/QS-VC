-- Support bounded transcript paging without sorting every segment for a meeting.
CREATE INDEX IF NOT EXISTS idx_transcript_segments_page
    ON public.meeting_transcript_segments (meeting_code, spoken_at, segment_id);

-- Docker's PostgreSQL entrypoint runs numbered SQL files directly and does not
-- populate the application's migration ledger. Bootstrap it after the complete
-- init sequence so a later `npm run db:migrate` does not replay migrations 001-016.
CREATE TABLE IF NOT EXISTS public._migrations (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255) UNIQUE NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public._migrations (filename) VALUES
    ('001_initial_schema.sql'),
    ('002_contact_enquiries.sql'),
    ('003_service_database_access.sql'),
    ('004_personal_signup.sql'),
    ('005_signup_tenant_and_platform_admins.sql'),
    ('006_enterprise_access_terms.sql'),
    ('007_meeting_live_status.sql'),
    ('008_problem_reports.sql'),
    ('009_platform_admin_analytics.sql'),
    ('010_user_trials.sql'),
    ('011_enterprise_approval_reviews.sql'),
    ('012_reassert_platform_admin_roles.sql'),
    ('013_linux_desktop_support.sql'),
    ('014_meeting_transcripts.sql'),
    ('015_room_numbers_and_devices.sql'),
    ('016_force_rls_and_tenant_policies.sql')
ON CONFLICT (filename) DO NOTHING;
