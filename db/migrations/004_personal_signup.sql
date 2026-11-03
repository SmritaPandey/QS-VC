-- Public accounts must never inherit the development tenant's Enterprise plan.
INSERT INTO tenants (name, slug, plan, max_participants, max_duration_min, storage_quota_gb)
VALUES ('Personal accounts', 'personal-free', 'free', 100, 60, 0)
ON CONFLICT (slug) DO NOTHING;
