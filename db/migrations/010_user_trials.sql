ALTER TABLE users
    ADD COLUMN subscription_plan VARCHAR(30),
    ADD COLUMN trial_started_at TIMESTAMPTZ,
    ADD COLUMN trial_ends_at TIMESTAMPTZ,
    ADD COLUMN enterprise_status VARCHAR(30);

ALTER TABLE users
    ADD CONSTRAINT users_subscription_plan_check
        CHECK (subscription_plan IS NULL OR subscription_plan IN ('starter_trial', 'starter', 'pro', 'enterprise')),
    ADD CONSTRAINT users_enterprise_status_check
        CHECK (enterprise_status IS NULL OR enterprise_status IN ('enterprise_pending', 'enterprise_approved', 'enterprise_rejected'));

CREATE INDEX idx_users_trial_ends_at ON users(trial_ends_at) WHERE subscription_plan = 'starter_trial';
