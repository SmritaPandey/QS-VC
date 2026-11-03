-- Public enquiries are stored only after explicit submission. There is no email delivery job.
-- No public read/update endpoint is provided. Restrict database access to authorised operators.
CREATE TABLE contact_enquiries (
    id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL CHECK (length(trim(name)) > 0),
    email VARCHAR(255) NOT NULL,
    organisation VARCHAR(200),
    topic VARCHAR(20) NOT NULL CHECK (topic IN ('demo', 'pricing', 'deployment', 'support')),
    message TEXT NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 4000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
