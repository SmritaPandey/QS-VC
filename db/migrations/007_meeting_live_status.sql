-- Signaling reports when a host starts or ends a meeting. The call has no tenant context,
-- so this narrow SECURITY DEFINER function updates only the live status of one meeting code.
CREATE OR REPLACE FUNCTION public.qsvc_set_meeting_live_status(code text, new_status text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
    IF new_status NOT IN ('active', 'ended') THEN
        RAISE EXCEPTION 'invalid live status %', new_status;
    END IF;
    UPDATE public.meetings SET
        status = new_status,
        actual_start = CASE WHEN new_status = 'active' THEN COALESCE(actual_start, NOW()) ELSE actual_start END,
        actual_end = CASE WHEN new_status = 'ended' THEN NOW() WHEN new_status = 'active' THEN NULL ELSE actual_end END,
        updated_at = NOW()
    WHERE meeting_code = upper(code) AND status <> 'cancelled';
    RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.qsvc_set_meeting_live_status(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qsvc_set_meeting_live_status(text, text) TO qsvc_meeting_service;

-- "Meetings I host" lists by host within a tenant.
CREATE INDEX IF NOT EXISTS idx_meetings_tenant_host ON meetings(tenant_id, host_id, created_at DESC);
