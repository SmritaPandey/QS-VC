-- Meeting transcripts and AI minutes. Rows exist only when a host turns on "Save transcript"
-- in the meeting (signaling announces it to everyone). Written by signaling through the
-- meeting service's internal endpoint; read back only by the meeting's host.
CREATE TABLE IF NOT EXISTS meeting_transcripts (
    meeting_code VARCHAR(30) NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    minutes TEXT CHECK (minutes IS NULL OR length(minutes) <= 20000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (meeting_code, started_at)
);
CREATE TABLE IF NOT EXISTS meeting_transcript_segments (
    meeting_code VARCHAR(30) NOT NULL,
    segment_id VARCHAR(140) NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    speaker VARCHAR(100) NOT NULL,
    language VARCHAR(20) NOT NULL,
    text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
    spoken_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (meeting_code, segment_id),
    FOREIGN KEY (meeting_code, started_at) REFERENCES meeting_transcripts (meeting_code, started_at) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_transcript_segments_time ON meeting_transcript_segments (meeting_code, spoken_at);
GRANT SELECT, INSERT, UPDATE ON meeting_transcripts TO qsvc_meeting_service;
GRANT SELECT, INSERT ON meeting_transcript_segments TO qsvc_meeting_service;
