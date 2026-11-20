CREATE TABLE public.plan_meeting_admins (
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    owner_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    delegate_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('admin', 'co_admin')),
    PRIMARY KEY (tenant_id, owner_id, delegate_id),
    CHECK (owner_id <> delegate_id)
);
CREATE INDEX plan_meeting_admins_by_delegate ON public.plan_meeting_admins (tenant_id, delegate_id);
REVOKE ALL ON public.plan_meeting_admins FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_meeting_admins TO qsvc_auth_service;

-- Views run as the migration owner, which may be subject to FORCE RLS on users.
CREATE POLICY plan_meeting_admin_migration_read ON public.users
    FOR SELECT TO CURRENT_USER USING (is_active);

CREATE VIEW public.meeting_plan_owners AS
SELECT u.id, u.tenant_id
FROM public.users u
JOIN public.tenants t ON t.id = u.tenant_id AND t.is_active
WHERE u.is_active AND (
    (u.subscription_plan = 'business' AND (u.subscription_expires_at IS NULL OR u.subscription_expires_at > NOW()))
    OR (u.subscription_plan = 'enterprise' AND u.enterprise_status = 'enterprise_approved')
);

CREATE VIEW public.active_plan_meeting_admins AS
SELECT a.tenant_id, a.owner_id, a.delegate_id, a.role
FROM public.plan_meeting_admins a
JOIN public.meeting_plan_owners owner ON owner.id = a.owner_id AND owner.tenant_id = a.tenant_id
JOIN public.users delegate ON delegate.id = a.delegate_id AND delegate.tenant_id = a.tenant_id AND delegate.is_active;

REVOKE ALL ON public.meeting_plan_owners, public.active_plan_meeting_admins FROM PUBLIC;
GRANT SELECT ON public.meeting_plan_owners, public.active_plan_meeting_admins TO qsvc_auth_service;
GRANT SELECT ON public.active_plan_meeting_admins TO qsvc_meeting_service;
