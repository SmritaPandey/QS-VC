-- In-meeting "Report a problem". Stored only when someone submits it; no public read endpoint.
CREATE TABLE IF NOT EXISTS problem_reports (
    id UUID PRIMARY KEY,
    meeting_code VARCHAR(30),
    category VARCHAR(20) NOT NULL CHECK (category IN ('audio', 'video', 'screen', 'connection', 'captions', 'other')),
    description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 2000),
    reporter_name VARCHAR(100),
    user_id UUID,
    diagnostics JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_problem_reports_created ON problem_reports(created_at DESC);
GRANT INSERT ON problem_reports TO qsvc_meeting_service;
