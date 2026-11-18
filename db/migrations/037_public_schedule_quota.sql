-- Public scheduling quota. No meeting details, invitations, or scheduled dates.
CREATE TABLE public.meeting_schedule_quota (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    issued_at TIMESTAMPTZ[] NOT NULL CHECK (cardinality(issued_at) BETWEEN 1 AND 7)
);
ALTER TABLE public.meeting_schedule_quota ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_schedule_quota FORCE ROW LEVEL SECURITY;
CREATE POLICY meeting_schedule_quota_tenant ON public.meeting_schedule_quota TO qsvc_meeting_service
USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID)
WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID);
REVOKE ALL ON public.meeting_schedule_quota FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.meeting_schedule_quota TO qsvc_meeting_service;
