ALTER TABLE users
    ADD COLUMN enterprise_reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN enterprise_reviewed_at TIMESTAMPTZ;

CREATE INDEX idx_users_enterprise_approval_queue
    ON users(tenant_id, created_at)
    WHERE subscription_plan = 'enterprise' AND enterprise_status = 'enterprise_pending';
