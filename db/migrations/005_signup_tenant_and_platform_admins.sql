-- Public sign-up needs the free personal tenant. Re-assert it (004 may not have run on every
-- database) and let the auth service create it itself if it is ever missing again.
INSERT INTO tenants (name, slug, plan, max_participants, max_duration_min, storage_quota_gb)
VALUES ('Personal accounts', 'personal-free', 'free', 100, 60, 0)
ON CONFLICT (slug) DO NOTHING;
GRANT INSERT (name, slug, plan, max_participants, max_duration_min, storage_quota_gb) ON tenants TO qsvc_auth_service;

-- Platform administrators (full access). The auth service also promotes these on sign-in;
-- keep this list in step with QSVC_ADMIN_EMAILS / services/auth/src/platform-admins.ts.
UPDATE users SET role = 'admin', updated_at = NOW()
WHERE lower(email) IN ('services@madylabs.xyz', 'contact@neurqai.com', 'smrita.official@gmail.com')
  AND role <> 'admin';
