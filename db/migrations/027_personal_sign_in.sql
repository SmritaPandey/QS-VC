ALTER TABLE public.user_identities
    DROP CONSTRAINT user_identities_provider_check,
    DROP CONSTRAINT user_identities_check,
    ADD CONSTRAINT user_identities_provider_check CHECK (provider IN ('keycloak', 'digilocker', 'google', 'microsoft')),
    ADD CONSTRAINT user_identities_provider_fields CHECK (
        (provider = 'keycloak' AND connection_id IS NOT NULL AND consent_at IS NULL)
        OR (provider = 'digilocker' AND connection_id IS NULL AND consent_at IS NOT NULL)
        OR (provider IN ('google', 'microsoft') AND connection_id IS NULL AND consent_at IS NULL)
    );

CREATE UNIQUE INDEX personal_identity_subject ON public.user_identities(tenant_id, provider, subject)
    WHERE provider IN ('google', 'microsoft');
CREATE UNIQUE INDEX personal_identity_account ON public.user_identities(tenant_id, user_id, provider)
    WHERE provider IN ('google', 'microsoft');

ALTER TABLE public.sso_challenges DROP CONSTRAINT sso_challenges_kind_check,
    ADD CONSTRAINT sso_challenges_kind_check CHECK (kind IN (
        'launch', 'oidc', 'exchange', 'digilocker', 'digilocker_launch', 'digilocker_consent',
        'personal_launch', 'personal_oidc', 'personal_exchange', 'personal_enrol', 'personal_email'
    ));
