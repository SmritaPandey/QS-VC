-- Dedicated webinar registration is separate from meeting admission and host permissions.
CREATE TABLE public.webinars (
    id UUID PRIMARY KEY,
    public_id UUID NOT NULL UNIQUE,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES public.users(id),
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    registration_limit INTEGER NOT NULL CHECK (registration_limit BETWEEN 1 AND 30000),
    published BOOLEAN NOT NULL DEFAULT false,
    custom_fields JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(custom_fields) = 'array' AND jsonb_array_length(custom_fields) <= 8),
    branding JSONB NOT NULL DEFAULT '{}',
    speakers JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (id, tenant_id)
);
CREATE TABLE public.webinar_registrations (
    id UUID PRIMARY KEY,
    webinar_id UUID NOT NULL,
    tenant_id UUID NOT NULL,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    answers JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    access_key_hash VARCHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    FOREIGN KEY (webinar_id, tenant_id) REFERENCES public.webinars(id, tenant_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX webinar_registration_email ON public.webinar_registrations(webinar_id, lower(email));
CREATE INDEX webinar_roster ON public.webinar_registrations(webinar_id, status, created_at);
CREATE INDEX webinars_owner ON public.webinars(tenant_id, owner_id, created_at DESC);
ALTER TABLE public.webinars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webinars FORCE ROW LEVEL SECURITY;
ALTER TABLE public.webinar_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webinar_registrations FORCE ROW LEVEL SECURITY;
CREATE POLICY webinar_tenant ON public.webinars TO qsvc_meeting_service
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID);
CREATE POLICY webinar_registration_tenant ON public.webinar_registrations TO qsvc_meeting_service
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID);
CREATE POLICY webinar_migration_read ON public.webinars FOR SELECT TO CURRENT_USER USING (true);
CREATE POLICY webinar_registration_migration_read ON public.webinar_registrations FOR SELECT TO CURRENT_USER USING (true);
GRANT SELECT, INSERT, UPDATE ON public.webinars, public.webinar_registrations TO qsvc_meeting_service;
REVOKE ALL ON public.webinars, public.webinar_registrations FROM PUBLIC;

CREATE FUNCTION public.qsvc_public_webinar(p_public_id UUID)
RETURNS TABLE(id UUID, tenant_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT w.id, w.tenant_id FROM public.webinars w
    JOIN public.meetings m ON m.id = w.meeting_id AND m.tenant_id = w.tenant_id
    WHERE w.public_id = p_public_id AND w.published AND m.status <> 'ended'
$$;
REVOKE ALL ON FUNCTION public.qsvc_public_webinar(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qsvc_public_webinar(UUID) TO qsvc_meeting_service;

ALTER TABLE public.guest_access_tokens ADD COLUMN webinar_registration_id UUID
    REFERENCES public.webinar_registrations(id) ON DELETE CASCADE;
-- Every guest-token check rechecks the current registration approval, including reconnects.
ALTER FUNCTION public.qsvc_validate_guest_token(text, text) RENAME TO qsvc_validate_guest_token_base;
REVOKE ALL ON FUNCTION public.qsvc_validate_guest_token_base(text, text) FROM PUBLIC, qsvc_meeting_service;
CREATE POLICY webinar_guest_migration_read ON public.guest_access_tokens FOR SELECT TO CURRENT_USER USING (true);
CREATE FUNCTION public.qsvc_validate_guest_token(code text, hash text)
RETURNS TABLE(valid boolean, token_id UUID, meeting_id UUID, tenant_id UUID, host_id UUID, meeting_status VARCHAR, reason TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.guest_access_tokens g
        LEFT JOIN public.webinar_registrations r ON r.id = g.webinar_registration_id AND r.tenant_id = g.tenant_id
        LEFT JOIN public.webinars w ON w.id = r.webinar_id AND w.tenant_id = r.tenant_id
        WHERE g.token_hash = hash AND g.webinar_registration_id IS NOT NULL
          AND (r.id IS NULL OR r.status <> 'approved' OR NOT w.published OR w.meeting_id <> g.meeting_id)
    ) THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::VARCHAR, 'Registration is not approved'::TEXT;
        RETURN;
    END IF;
    RETURN QUERY SELECT * FROM public.qsvc_validate_guest_token_base(code, hash);
END $$;
REVOKE ALL ON FUNCTION public.qsvc_validate_guest_token(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qsvc_validate_guest_token(text, text) TO qsvc_meeting_service;
