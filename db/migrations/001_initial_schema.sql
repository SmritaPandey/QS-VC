-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- QS-VC Initial Schema
-- Migration 001: Core tables
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TENANTS (Multi-tenant SaaS)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE tenants (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(100) UNIQUE NOT NULL,
    plan            VARCHAR(50) NOT NULL DEFAULT 'free',  -- free, pro, enterprise
    settings        JSONB NOT NULL DEFAULT '{}',
    max_participants INT NOT NULL DEFAULT 100,
    max_duration_min INT NOT NULL DEFAULT 60,
    storage_quota_gb INT NOT NULL DEFAULT 5,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- USERS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email           VARCHAR(255) NOT NULL,
    display_name    VARCHAR(255) NOT NULL,
    password_hash   VARCHAR(255),
    avatar_url      TEXT,
    role            VARCHAR(50) NOT NULL DEFAULT 'member',  -- admin, moderator, member, guest
    auth_provider   VARCHAR(50) NOT NULL DEFAULT 'local',   -- local, google, microsoft, saml
    auth_provider_id VARCHAR(255),
    preferences     JSONB NOT NULL DEFAULT '{}',
    last_login_at   TIMESTAMPTZ,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(tenant_id, email)
);

CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_email ON users(email);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MEETINGS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE meetings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    meeting_code    VARCHAR(30) UNIQUE NOT NULL,
    title           VARCHAR(255),
    host_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    type            VARCHAR(50) NOT NULL DEFAULT 'instant',  -- instant, scheduled, recurring
    status          VARCHAR(50) NOT NULL DEFAULT 'waiting',  -- waiting, active, ended
    scheduled_start TIMESTAMPTZ,
    scheduled_end   TIMESTAMPTZ,
    actual_start    TIMESTAMPTZ,
    actual_end      TIMESTAMPTZ,
    settings        JSONB NOT NULL DEFAULT '{
        "max_participants": 100,
        "waiting_room": false,
        "e2ee_required": false,
        "recording_allowed": true,
        "chat_enabled": true,
        "screen_share_enabled": true
    }',
    recording_url   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_meetings_tenant ON meetings(tenant_id);
CREATE INDEX idx_meetings_code ON meetings(meeting_code);
CREATE INDEX idx_meetings_host ON meetings(host_id);
CREATE INDEX idx_meetings_status ON meetings(status);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MEETING PARTICIPANTS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE meeting_participants (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    meeting_id      UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    display_name    VARCHAR(255) NOT NULL,
    role            VARCHAR(50) NOT NULL DEFAULT 'participant',  -- host, co-host, participant
    join_time       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    leave_time      TIMESTAMPTZ,
    duration_sec    INT,
    ip_address      INET,
    user_agent      TEXT,
    device_type     VARCHAR(50),  -- desktop, mobile, room-system
    network_quality JSONB,        -- { avg_rtt, packet_loss, bitrate }
    
    UNIQUE(meeting_id, user_id)
);

CREATE INDEX idx_participants_meeting ON meeting_participants(meeting_id);
CREATE INDEX idx_participants_user ON meeting_participants(user_id);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- CHAT MESSAGES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE chat_messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    meeting_id      UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    sender_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    sender_name     VARCHAR(255) NOT NULL,
    content         TEXT NOT NULL,
    type            VARCHAR(50) NOT NULL DEFAULT 'text',  -- text, file, system
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_meeting ON chat_messages(meeting_id);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- RECORDINGS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE recordings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    meeting_id      UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    type            VARCHAR(50) NOT NULL DEFAULT 'composite', -- composite, individual, audio
    status          VARCHAR(50) NOT NULL DEFAULT 'recording', -- recording, processing, ready, failed
    storage_path    TEXT,
    file_size_bytes BIGINT,
    duration_sec    INT,
    format          VARCHAR(50) DEFAULT 'webm',
    transcript_url  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recordings_meeting ON recordings(meeting_id);
CREATE INDEX idx_recordings_tenant ON recordings(tenant_id);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- ROW-LEVEL SECURITY (Multi-Tenant Isolation)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;

-- RLS Policies: each tenant only sees their own data
CREATE POLICY tenant_isolation_users ON users
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE POLICY tenant_isolation_meetings ON meetings
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE POLICY tenant_isolation_recordings ON recordings
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SEED: default tenant for development
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INSERT INTO tenants (id, name, slug, plan, max_participants, max_duration_min, storage_quota_gb)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Development Org',
    'dev',
    'enterprise',
    250,
    480,
    100
) ON CONFLICT DO NOTHING;

INSERT INTO users (id, tenant_id, email, display_name, role, password_hash)
VALUES (
    '00000000-0000-0000-0000-000000000010',
    '00000000-0000-0000-0000-000000000001',
    'admin@qsvc.dev',
    'Admin User',
    'admin',
    crypt('admin123', gen_salt('bf'))
) ON CONFLICT DO NOTHING;
