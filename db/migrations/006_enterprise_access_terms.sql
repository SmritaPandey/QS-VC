CREATE TABLE enterprise_access_terms (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    workspace_url text NOT NULL,
    expires_at timestamptz NOT NULL,
    approved_by uuid NOT NULL REFERENCES users(id),
    updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON enterprise_access_terms TO qsvc_auth_service;
