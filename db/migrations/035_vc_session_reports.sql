-- Server-observed attendance with explicitly client-reported quality/sound-activity figures.
CREATE TABLE public.vc_session_reports (
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    peer_id VARCHAR(128) NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    incomplete BOOLEAN NOT NULL DEFAULT FALSE,
    participant JSONB NOT NULL CHECK (jsonb_typeof(participant) = 'object'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (session_id, peer_id)
);
CREATE INDEX vc_session_reports_meeting_time ON public.vc_session_reports (meeting_id, started_at DESC, peer_id);
CREATE INDEX vc_session_reports_retention ON public.vc_session_reports (started_at);
ALTER TABLE public.vc_session_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vc_session_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY vc_session_reports_tenant ON public.vc_session_reports
USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID)
WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID);
REVOKE ALL ON public.vc_session_reports FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vc_session_reports TO qsvc_meeting_service;
