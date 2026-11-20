-- Apply the stage policy to legacy rooms linked to webinar registration.
-- Limit the migration role's temporary RLS access to meetings with an attached webinar.
CREATE POLICY meeting_webinar_migration_read ON public.meetings FOR SELECT TO CURRENT_USER
    USING (EXISTS (SELECT 1 FROM public.webinars w WHERE w.meeting_id = meetings.id AND w.tenant_id = meetings.tenant_id));
CREATE POLICY meeting_webinar_migration_update ON public.meetings FOR UPDATE TO CURRENT_USER
    USING (EXISTS (SELECT 1 FROM public.webinars w WHERE w.meeting_id = meetings.id AND w.tenant_id = meetings.tenant_id))
    WITH CHECK (EXISTS (SELECT 1 FROM public.webinars w WHERE w.meeting_id = meetings.id AND w.tenant_id = meetings.tenant_id));

UPDATE public.meetings m
SET settings = COALESCE(m.settings, '{}'::jsonb) || '{"meetingKind":"webinar","webinar":true}'::jsonb
WHERE (m.settings ->> 'meetingKind' IS DISTINCT FROM 'webinar' OR m.settings -> 'webinar' IS DISTINCT FROM 'true'::jsonb)
    AND EXISTS (SELECT 1 FROM public.webinars w WHERE w.meeting_id = m.id AND w.tenant_id = m.tenant_id);

DROP POLICY meeting_webinar_migration_update ON public.meetings;
DROP POLICY meeting_webinar_migration_read ON public.meetings;
