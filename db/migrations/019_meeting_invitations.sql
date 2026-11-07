-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 019_meeting_invitations.sql
-- Meeting invitations, in-app notifications, and hashed guest access tokens
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. MEETING INVITATIONS
CREATE TABLE IF NOT EXISTS public.meeting_invitations (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    meeting_id        UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
    tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    inviter_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    invitee_user_id   UUID REFERENCES public.users(id) ON DELETE CASCADE,
    invite_type       VARCHAR(50) NOT NULL DEFAULT 'member',  -- 'member', 'guest'
    assigned_role     VARCHAR(50) NOT NULL DEFAULT 'participant', -- 'participant', 'co-host'
    invitation_status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'accepted', 'declined', 'revoked', 'expired'
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at        TIMESTAMPTZ,
    responded_at      TIMESTAMPTZ,
    revoked_at        TIMESTAMPTZ,

    CONSTRAINT uq_meeting_invitee UNIQUE (meeting_id, invitee_user_id)
);

CREATE INDEX IF NOT EXISTS idx_invitations_meeting ON public.meeting_invitations(meeting_id);
CREATE INDEX IF NOT EXISTS idx_invitations_tenant ON public.meeting_invitations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invitations_invitee ON public.meeting_invitations(invitee_user_id);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON public.meeting_invitations(invitation_status);

-- 2. USER NOTIFICATIONS (In-app notifications)
CREATE TABLE IF NOT EXISTS public.user_notifications (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id             UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    recipient_user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    notification_type     VARCHAR(50) NOT NULL DEFAULT 'meeting_invitation',
    title                 VARCHAR(255) NOT NULL,
    message               TEXT NOT NULL,
    related_meeting_id    UUID REFERENCES public.meetings(id) ON DELETE CASCADE,
    related_invitation_id UUID REFERENCES public.meeting_invitations(id) ON DELETE CASCADE,
    is_read               BOOLEAN NOT NULL DEFAULT FALSE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON public.user_notifications(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON public.user_notifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON public.user_notifications(recipient_user_id, is_read);

-- 3. GUEST ACCESS TOKENS (Hashed token storage)
CREATE TABLE IF NOT EXISTS public.guest_access_tokens (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    meeting_id   UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
    tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    token_hash   VARCHAR(128) NOT NULL UNIQUE,
    created_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    revoked_at   TIMESTAMPTZ,
    max_uses     INT NOT NULL DEFAULT 100,
    usage_count  INT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guest_tokens_meeting ON public.guest_access_tokens(meeting_id);
CREATE INDEX IF NOT EXISTS idx_guest_tokens_hash ON public.guest_access_tokens(token_hash);

-- Row-Level Security
ALTER TABLE public.meeting_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_invitations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.guest_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_access_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_meeting_invitations ON public.meeting_invitations;
CREATE POLICY tenant_isolation_meeting_invitations ON public.meeting_invitations
    TO qsvc_meeting_service
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID);

DROP POLICY IF EXISTS tenant_isolation_user_notifications ON public.user_notifications;
CREATE POLICY tenant_isolation_user_notifications ON public.user_notifications
    TO qsvc_meeting_service
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID);

DROP POLICY IF EXISTS tenant_isolation_guest_access_tokens ON public.guest_access_tokens;
CREATE POLICY tenant_isolation_guest_access_tokens ON public.guest_access_tokens
    TO qsvc_meeting_service
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_invitations TO qsvc_meeting_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_notifications TO qsvc_meeting_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.guest_access_tokens TO qsvc_meeting_service;

-- Validates a guest token without requiring caller to know tenant beforehand.
CREATE OR REPLACE FUNCTION public.qsvc_validate_guest_token(code text, hash text)
RETURNS TABLE (
    valid boolean,
    token_id uuid,
    meeting_id uuid,
    tenant_id uuid,
    host_id uuid,
    meeting_status varchar,
    reason text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
    rec RECORD;
BEGIN
    SELECT g.id, g.meeting_id, g.tenant_id, g.expires_at, g.revoked_at, g.max_uses, g.usage_count,
           m.status as m_status, m.host_id
    INTO rec
    FROM public.guest_access_tokens g
    JOIN public.meetings m ON m.id = g.meeting_id
    WHERE m.meeting_code = upper(code) AND g.token_hash = hash;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::varchar, 'Token not found'::text;
        RETURN;
    END IF;

    IF rec.revoked_at IS NOT NULL THEN
        RETURN QUERY SELECT false, rec.id, rec.meeting_id, rec.tenant_id, rec.host_id, rec.m_status, 'Token has been revoked'::text;
        RETURN;
    END IF;

    IF rec.expires_at < NOW() THEN
        RETURN QUERY SELECT false, rec.id, rec.meeting_id, rec.tenant_id, rec.host_id, rec.m_status, 'Token has expired'::text;
        RETURN;
    END IF;

    IF rec.usage_count >= rec.max_uses THEN
        RETURN QUERY SELECT false, rec.id, rec.meeting_id, rec.tenant_id, rec.host_id, rec.m_status, 'Token usage limit exceeded'::text;
        RETURN;
    END IF;

    RETURN QUERY SELECT true, rec.id, rec.meeting_id, rec.tenant_id, rec.host_id, rec.m_status, 'Valid'::text;
END $$;

REVOKE ALL ON FUNCTION public.qsvc_validate_guest_token(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qsvc_validate_guest_token(text, text) TO qsvc_meeting_service;

-- Increment usage count for guest token
CREATE OR REPLACE FUNCTION public.qsvc_increment_guest_token_use(p_token_id uuid)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
    UPDATE public.guest_access_tokens
    SET usage_count = usage_count + 1
    WHERE id = p_token_id AND revoked_at IS NULL AND expires_at > NOW() AND usage_count < max_uses
    RETURNING true;
$$;

REVOKE ALL ON FUNCTION public.qsvc_increment_guest_token_use(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qsvc_increment_guest_token_use(uuid) TO qsvc_meeting_service;

