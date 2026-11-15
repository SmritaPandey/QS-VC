-- Organisation identity for meeting and prejoin surfaces; no external image URLs.
CREATE TABLE public.tenant_branding (
    tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
    organisation_name VARCHAR(80) NOT NULL CHECK (length(btrim(organisation_name)) > 0),
    logo_data_url TEXT CHECK (logo_data_url IS NULL OR (length(logo_data_url) <= 65558 AND logo_data_url LIKE 'data:image/png;base64,%')),
    accent VARCHAR(7) NOT NULL CHECK (accent ~ '^#[a-fA-F0-9]{6}$'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.tenant_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_branding FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_branding_tenant ON public.tenant_branding TO qsvc_meeting_service
USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID)
WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID);
REVOKE ALL ON public.tenant_branding FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.tenant_branding TO qsvc_meeting_service;
