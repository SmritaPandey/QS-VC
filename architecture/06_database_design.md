# QS-VC: Database Design

---

## 1. Database Technology Selection

| Database | Purpose | Justification |
|---|---|---|
| **PostgreSQL 16 + Citus** | Primary OLTP | ACID, JSON support, RLS for multi-tenancy, horizontal sharding via Citus |
| **Redis 7 Cluster** | Cache, sessions, PubSub | Sub-ms latency, pub/sub for real-time signaling coordination |
| **ClickHouse** | Analytics, telemetry | Columnar, fast aggregation over billions of QoS data points |
| **Elasticsearch 8** | Search, logging | Full-text search on transcripts, centralized log aggregation |
| **Apache Kafka** | Event sourcing | Durable event stream for audit, analytics, async processing |
| **MinIO / S3** | Object storage | Recordings, attachments, AI model artifacts |

---

## 2. PostgreSQL Schema (Core OLTP)

### Multi-Tenancy Strategy: Row-Level Security (RLS)

```sql
-- Tenant isolation via RLS (every table has tenant_id)
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON meetings
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
```

### Core Tables

```sql
-- ============================================================
-- TENANT & ORGANIZATION
-- ============================================================

CREATE TABLE tenants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(100) UNIQUE NOT NULL,
    plan            VARCHAR(50) NOT NULL DEFAULT 'standard',  -- free/standard/enterprise/govt
    max_participants INT NOT NULL DEFAULT 100,
    max_meeting_duration_min INT NOT NULL DEFAULT 480,
    features        JSONB NOT NULL DEFAULT '{}',
    data_region     VARCHAR(20) NOT NULL DEFAULT 'in-mum',   -- data sovereignty
    pqc_enabled     BOOLEAN NOT NULL DEFAULT true,
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE organizations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    name            VARCHAR(255) NOT NULL,
    domain          VARCHAR(255),
    sso_config      JSONB,          -- SAML/OIDC configuration
    branding        JSONB,          -- logo, colors, custom domain
    settings        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- USERS & AUTHENTICATION
-- ============================================================

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    org_id          UUID REFERENCES organizations(id),
    email           VARCHAR(320) NOT NULL,
    display_name    VARCHAR(255) NOT NULL,
    avatar_url      VARCHAR(512),
    role            VARCHAR(50) NOT NULL DEFAULT 'user',  -- superadmin/admin/host/user/guest
    auth_provider   VARCHAR(50) NOT NULL DEFAULT 'local', -- local/saml/oidc/ldap
    external_id     VARCHAR(255),                         -- SSO external ID
    pqc_public_key  BYTEA,                                -- Dilithium public key
    mfa_enabled     BOOLEAN NOT NULL DEFAULT false,
    mfa_secret      BYTEA,                                -- encrypted TOTP secret
    preferred_lang  VARCHAR(10) NOT NULL DEFAULT 'en',
    timezone        VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, email)
);

CREATE TABLE user_devices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    device_name     VARCHAR(255),
    device_type     VARCHAR(50),     -- web/desktop/mobile/room_system
    os              VARCHAR(100),
    browser         VARCHAR(100),
    fido2_cred_id   BYTEA,           -- WebAuthn credential
    push_token      VARCHAR(512),
    last_used_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- MEETINGS & SCHEDULING
-- ============================================================

CREATE TABLE meetings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    host_id         UUID NOT NULL REFERENCES users(id),
    title           VARCHAR(500) NOT NULL,
    description     TEXT,
    meeting_type    VARCHAR(30) NOT NULL DEFAULT 'instant',
        -- instant / scheduled / recurring / webinar / broadcast
    status          VARCHAR(30) NOT NULL DEFAULT 'scheduled',
        -- scheduled / waiting / active / ended / cancelled
    scheduled_start TIMESTAMPTZ,
    scheduled_end   TIMESTAMPTZ,
    actual_start    TIMESTAMPTZ,
    actual_end      TIMESTAMPTZ,
    timezone        VARCHAR(50),
    
    -- Meeting settings
    password        VARCHAR(100),         -- meeting password (hashed)
    waiting_room    BOOLEAN NOT NULL DEFAULT true,
    e2ee_enabled    BOOLEAN NOT NULL DEFAULT false,
    recording_mode  VARCHAR(30) DEFAULT 'none',  -- none/cloud/local/auto
    ai_captions     BOOLEAN NOT NULL DEFAULT true,
    ai_translation  BOOLEAN NOT NULL DEFAULT false,
    translation_langs VARCHAR(200),       -- comma-separated lang codes
    max_participants INT,
    
    -- Recurrence (RFC 5545 RRULE)
    recurrence_rule TEXT,
    recurrence_parent_id UUID REFERENCES meetings(id),
    
    -- Join info
    join_url        VARCHAR(512) NOT NULL,
    meeting_code    VARCHAR(20) NOT NULL UNIQUE,  -- human-readable code
    pstn_numbers    JSONB,                        -- dial-in numbers
    sip_uri         VARCHAR(255),                 -- SIP dial-in
    
    -- SFU routing
    sfu_node_id     VARCHAR(100),
    sfu_region      VARCHAR(20),
    
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_meetings_tenant_status ON meetings(tenant_id, status);
CREATE INDEX idx_meetings_host ON meetings(host_id);
CREATE INDEX idx_meetings_scheduled ON meetings(scheduled_start) WHERE status = 'scheduled';
CREATE INDEX idx_meetings_code ON meetings(meeting_code);

CREATE TABLE meeting_participants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id      UUID NOT NULL REFERENCES meetings(id),
    user_id         UUID REFERENCES users(id),        -- null for guests
    display_name    VARCHAR(255) NOT NULL,
    email           VARCHAR(320),
    role            VARCHAR(30) NOT NULL DEFAULT 'attendee',
        -- host / co-host / presenter / attendee / guest
    join_time       TIMESTAMPTZ,
    leave_time      TIMESTAMPTZ,
    duration_sec    INT,
    device_type     VARCHAR(50),
    ip_address      INET,
    geo_region      VARCHAR(20),
    connection_type VARCHAR(30),      -- wifi / cellular / wired
    
    -- Quality metrics (populated on leave)
    avg_audio_mos   DECIMAL(3,2),     -- Mean Opinion Score 1.0-5.0
    avg_video_mos   DECIMAL(3,2),
    avg_bandwidth_kbps INT,
    packet_loss_pct DECIMAL(5,2),
    jitter_ms       INT,
    
    status          VARCHAR(20) NOT NULL DEFAULT 'invited',
        -- invited / waiting / joined / left / removed
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_participants_meeting ON meeting_participants(meeting_id);
CREATE INDEX idx_participants_user ON meeting_participants(user_id);

-- ============================================================
-- RECORDINGS & TRANSCRIPTS
-- ============================================================

CREATE TABLE recordings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    meeting_id      UUID NOT NULL REFERENCES meetings(id),
    type            VARCHAR(30) NOT NULL,  -- composite/speaker_view/gallery/audio_only
    format          VARCHAR(10) NOT NULL,  -- mp4/webm/mkv/wav
    storage_path    VARCHAR(1024) NOT NULL, -- S3/MinIO path
    storage_region  VARCHAR(20) NOT NULL,
    size_bytes      BIGINT,
    duration_sec    INT,
    resolution      VARCHAR(20),           -- 1920x1080
    encryption_key_id VARCHAR(100),        -- Vault key reference
    status          VARCHAR(20) NOT NULL DEFAULT 'processing',
        -- recording / processing / ready / expired / deleted
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transcripts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    meeting_id      UUID NOT NULL REFERENCES meetings(id),
    language        VARCHAR(10) NOT NULL,
    content         JSONB NOT NULL,        -- timestamped transcript segments
        -- [{"start": 0.0, "end": 2.5, "speaker": "Alice", "text": "..."}]
    word_count      INT,
    confidence_avg  DECIMAL(4,3),
    status          VARCHAR(20) NOT NULL DEFAULT 'processing',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE meeting_summaries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    meeting_id      UUID NOT NULL REFERENCES meetings(id),
    summary_text    TEXT NOT NULL,
    topics          JSONB,                 -- topic segments with summaries
    action_items    JSONB,                 -- extracted action items
    key_decisions   JSONB,                 -- decisions made
    sentiment       JSONB,                 -- sentiment analysis results
    model_version   VARCHAR(50),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- CHAT & COLLABORATION
-- ============================================================

CREATE TABLE chat_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    meeting_id      UUID REFERENCES meetings(id),
    channel_id      UUID,                  -- for persistent chat channels
    sender_id       UUID NOT NULL REFERENCES users(id),
    message_type    VARCHAR(20) NOT NULL DEFAULT 'text',
        -- text / file / reaction / system / poll
    content         TEXT,
    e2e_encrypted   BOOLEAN NOT NULL DEFAULT false,
    e2e_payload     BYTEA,                 -- PQC-encrypted content
    reply_to_id     UUID REFERENCES chat_messages(id),
    mentions        UUID[],
    reactions       JSONB DEFAULT '{}',    -- {"👍": ["user1","user2"]}
    edited_at       TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_meeting ON chat_messages(meeting_id, created_at);

CREATE TABLE file_attachments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    uploader_id     UUID NOT NULL REFERENCES users(id),
    meeting_id      UUID REFERENCES meetings(id),
    filename        VARCHAR(500) NOT NULL,
    mime_type       VARCHAR(100),
    size_bytes      BIGINT NOT NULL,
    storage_path    VARCHAR(1024) NOT NULL,
    encryption_key_id VARCHAR(100),
    virus_scan_status VARCHAR(20) DEFAULT 'pending',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- LICENSING & BILLING
-- ============================================================

CREATE TABLE licenses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    license_type    VARCHAR(50) NOT NULL,   -- per_seat / per_room / concurrent / unlimited
    max_seats       INT,
    max_rooms       INT,
    max_concurrent  INT,
    features        JSONB NOT NULL,         -- feature flags
    valid_from      TIMESTAMPTZ NOT NULL,
    valid_until     TIMESTAMPTZ NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE usage_records (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    metric          VARCHAR(50) NOT NULL,
        -- meeting_minutes / participants / recordings_gb / ai_stt_minutes / api_calls
    value           BIGINT NOT NULL,
    period_start    TIMESTAMPTZ NOT NULL,
    period_end      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- AUDIT LOG (Tamper-Proof)
-- ============================================================

CREATE TABLE audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       UUID NOT NULL,
    actor_id        UUID,
    actor_ip        INET,
    actor_device    VARCHAR(100),
    action          VARCHAR(100) NOT NULL,
    resource_type   VARCHAR(50) NOT NULL,
    resource_id     VARCHAR(255),
    outcome         VARCHAR(20) NOT NULL,  -- success / failure / denied
    details         JSONB,
    prev_hash       BYTEA NOT NULL,        -- SHA3-256 chain
    entry_hash      BYTEA NOT NULL,        -- SHA3-256(prev_hash + entry)
    signature       BYTEA NOT NULL,        -- Dilithium signature
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partitioned by month for performance
CREATE TABLE audit_logs_2025_01 PARTITION OF audit_logs
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
```

---

## 3. Citus Sharding Strategy

```sql
-- Shard key: tenant_id (co-locate all tenant data)
SELECT create_distributed_table('meetings', 'tenant_id');
SELECT create_distributed_table('meeting_participants', 'meeting_id',
  colocate_with => 'meetings');
SELECT create_distributed_table('recordings', 'tenant_id',
  colocate_with => 'meetings');
SELECT create_distributed_table('chat_messages', 'tenant_id',
  colocate_with => 'meetings');
SELECT create_distributed_table('audit_logs', 'tenant_id',
  colocate_with => 'meetings');

-- Reference tables (replicated to all nodes)
SELECT create_reference_table('tenants');
SELECT create_reference_table('licenses');
```

---

## 4. ClickHouse Analytics Schema

```sql
-- Real-time quality metrics (billions of rows)
CREATE TABLE qos_metrics (
    meeting_id      UUID,
    participant_id  UUID,
    tenant_id       UUID,
    timestamp       DateTime64(3),
    
    -- Audio metrics
    audio_bitrate_kbps    UInt32,
    audio_packet_loss_pct Float32,
    audio_jitter_ms       UInt16,
    audio_mos             Float32,
    
    -- Video metrics
    video_bitrate_kbps    UInt32,
    video_fps             UInt8,
    video_resolution_w    UInt16,
    video_resolution_h    UInt16,
    video_packet_loss_pct Float32,
    
    -- Network
    rtt_ms                UInt16,
    bandwidth_est_kbps    UInt32,
    connection_type       LowCardinality(String),
    
    -- SFU
    sfu_node_id           LowCardinality(String),
    sfu_region            LowCardinality(String),
    simulcast_layer       UInt8
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (tenant_id, meeting_id, participant_id, timestamp)
TTL timestamp + INTERVAL 90 DAY;

-- Meeting analytics (aggregated)
CREATE MATERIALIZED VIEW meeting_quality_summary
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (tenant_id, meeting_id)
AS SELECT
    tenant_id,
    meeting_id,
    min(timestamp) AS start_time,
    max(timestamp) AS end_time,
    avg(audio_mos) AS avg_audio_mos,
    avg(video_bitrate_kbps) AS avg_video_bitrate,
    max(audio_packet_loss_pct) AS peak_audio_loss,
    countDistinct(participant_id) AS unique_participants,
    count() AS total_samples
FROM qos_metrics
GROUP BY tenant_id, meeting_id;
```

---

## 5. Redis Data Structures

```
# Active meeting state (TTL: meeting duration + 1h)
HASH  meeting:{meetingId}:state
  - status: "active"
  - host_id: "uuid"
  - sfu_node: "sfu-mumbai-1"
  - participant_count: 15
  - recording: "true"
  - e2ee: "true"
  - started_at: "1705312000"

# Participant list per meeting
SET   meeting:{meetingId}:participants
  - "userId1", "userId2", ...

# Active speaker tracking
ZSET  meeting:{meetingId}:speakers
  - userId1: 1705312100  (last spoke timestamp)
  - userId2: 1705312095

# Signaling channel (WebSocket routing)
STREAM  signaling:{meetingId}
  - { type: "produce", userId: "...", ... }

# User session (TTL: 24h)
HASH  session:{sessionToken}
  - user_id: "uuid"
  - tenant_id: "uuid"
  - device_id: "uuid"
  - ip: "1.2.3.4"
  - created_at: "1705312000"

# Rate limiting
STRING  ratelimit:{userId}:{action}  TTL=60  INCR

# TURN credential cache (TTL: 1h)
HASH  turn:creds:{userId}
  - username: "timestamp:userId"
  - credential: "hmac_sha1(secret, username)"
```
