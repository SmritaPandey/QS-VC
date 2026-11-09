CREATE TABLE public.sso_connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    domain text NOT NULL CHECK (domain = lower(domain) AND length(domain) BETWEEN 3 AND 253),
    dns_token text NOT NULL,
    verified_at timestamptz,
    provider text CHECK (provider IN ('oidc', 'saml')),
    tested_at timestamptz,
    enforce_sso boolean NOT NULL DEFAULT false,
    UNIQUE (tenant_id, domain),
    UNIQUE (tenant_id, id),
    CHECK (NOT enforce_sso OR (verified_at IS NOT NULL AND provider IS NOT NULL AND tested_at IS NOT NULL))
);
CREATE UNIQUE INDEX sso_verified_domain ON public.sso_connections(domain) WHERE verified_at IS NOT NULL;
CREATE UNIQUE INDEX users_tenant_identity_key ON public.users(tenant_id, id);

CREATE TABLE public.user_identities (
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    connection_id uuid,
    provider text NOT NULL CHECK (provider IN ('keycloak', 'digilocker')),
    subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
    consent_at timestamptz,
    FOREIGN KEY (tenant_id, user_id) REFERENCES public.users(tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, connection_id) REFERENCES public.sso_connections(tenant_id, id) ON DELETE CASCADE,
    UNIQUE (connection_id, subject),
    UNIQUE (connection_id, user_id),
    CHECK ((provider = 'keycloak' AND connection_id IS NOT NULL AND consent_at IS NULL)
        OR (provider = 'digilocker' AND connection_id IS NULL AND consent_at IS NOT NULL))
);
CREATE UNIQUE INDEX user_digilocker_identity ON public.user_identities(tenant_id, user_id) WHERE provider = 'digilocker';
CREATE UNIQUE INDEX digilocker_tenant_subject ON public.user_identities(tenant_id, subject) WHERE provider = 'digilocker';

ALTER TABLE public.sso_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sso_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_identities FORCE ROW LEVEL SECURITY;
CREATE POLICY sso_connections_tenant ON public.sso_connections TO qsvc_auth_service
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
CREATE POLICY sso_connections_discover ON public.sso_connections FOR SELECT TO qsvc_auth_service
    USING (verified_at IS NOT NULL AND domain = current_setting('app.sso_domain', true));
CREATE POLICY user_identities_tenant ON public.user_identities TO qsvc_auth_service
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
-- qs_auth_app inherits this group in the production account setup.
GRANT SELECT, INSERT, UPDATE ON public.sso_connections, public.user_identities TO qsvc_auth_service;

-- Transient, high-entropy credentials used before the caller has a tenant or session.
CREATE TABLE public.sso_challenges (
    key_hash text PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('launch', 'oidc', 'exchange', 'digilocker', 'digilocker_launch', 'digilocker_consent')),
    payload jsonb NOT NULL,
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes')
);
CREATE INDEX sso_challenges_expiry ON public.sso_challenges(expires_at);
ALTER TABLE public.sso_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sso_challenges FORCE ROW LEVEL SECURITY;
CREATE POLICY sso_challenge_read ON public.sso_challenges FOR SELECT TO qsvc_auth_service
    USING (key_hash = current_setting('app.sso_challenge', true) OR expires_at <= now());
CREATE POLICY sso_challenge_delete ON public.sso_challenges FOR DELETE TO qsvc_auth_service
    USING (key_hash = current_setting('app.sso_challenge', true) OR expires_at <= now());
CREATE POLICY sso_challenge_write ON public.sso_challenges FOR INSERT TO qsvc_auth_service
    WITH CHECK (key_hash = current_setting('app.sso_challenge', true));
GRANT SELECT, INSERT, DELETE ON public.sso_challenges TO qsvc_auth_service;
