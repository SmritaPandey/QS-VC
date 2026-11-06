-- Make table owners obey row policies too. Superusers still bypass RLS, so production
-- application services must use the separate non-superuser login roles.
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
ALTER TABLE public.meetings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_participants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.recordings FORCE ROW LEVEL SECURITY;

-- These tables do not carry tenant_id directly; scope them through their meeting.
CREATE POLICY tenant_isolation_participants ON public.meeting_participants
    TO qsvc_meeting_service
    USING (EXISTS (
        SELECT 1 FROM public.meetings m
        WHERE m.id = meeting_participants.meeting_id
          AND m.tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.meetings m
        WHERE m.id = meeting_participants.meeting_id
          AND m.tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
    ));

CREATE POLICY tenant_isolation_chat_messages ON public.chat_messages
    TO qsvc_meeting_service
    USING (EXISTS (
        SELECT 1 FROM public.meetings m
        WHERE m.id = chat_messages.meeting_id
          AND m.tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.meetings m
        WHERE m.id = chat_messages.meeting_id
          AND m.tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
    ));

CREATE POLICY tenant_isolation_meeting_transcripts ON public.meeting_transcripts
    TO qsvc_meeting_service
    USING (EXISTS (
        SELECT 1 FROM public.meetings m
        WHERE m.meeting_code = meeting_transcripts.meeting_code
          AND m.tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.meetings m
        WHERE m.meeting_code = meeting_transcripts.meeting_code
          AND m.tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
    ));

CREATE POLICY tenant_isolation_transcript_segments ON public.meeting_transcript_segments
    TO qsvc_meeting_service
    USING (EXISTS (
        SELECT 1 FROM public.meetings m
        WHERE m.meeting_code = meeting_transcript_segments.meeting_code
          AND m.tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.meetings m
        WHERE m.meeting_code = meeting_transcript_segments.meeting_code
          AND m.tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
    ));

ALTER TABLE public.meeting_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_transcript_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_transcripts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_transcript_segments FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_participants TO qsvc_meeting_service;
GRANT SELECT, INSERT, DELETE ON public.chat_messages TO qsvc_meeting_service;
GRANT SELECT, INSERT, UPDATE ON public.meeting_transcripts TO qsvc_meeting_service;
GRANT SELECT, INSERT ON public.meeting_transcript_segments TO qsvc_meeting_service;

-- Internal signaling writes know the meeting code but not its tenant. Return only the
-- tenant identifier for that exact code, then the service scopes its transaction with RLS.
CREATE FUNCTION public.qsvc_tenant_id_by_meeting_code(code text)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT m.tenant_id FROM public.meetings m WHERE m.meeting_code = upper(code) $$;
REVOKE ALL ON FUNCTION public.qsvc_tenant_id_by_meeting_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qsvc_tenant_id_by_meeting_code(text) TO qsvc_meeting_service;

-- Keep transcript retention bounded to the most recent 90 days. This is the only
-- cross-tenant cleanup operation exposed to the meeting service.
CREATE FUNCTION public.qsvc_prune_old_meeting_transcripts()
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE removed BIGINT;
BEGIN
    DELETE FROM public.meeting_transcripts WHERE started_at < NOW() - INTERVAL '90 days';
    GET DIAGNOSTICS removed = ROW_COUNT;
    RETURN removed;
END $$;
REVOKE ALL ON FUNCTION public.qsvc_prune_old_meeting_transcripts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qsvc_prune_old_meeting_transcripts() TO qsvc_meeting_service;
