-- Room numbers and room devices for MCU and SIP/H.323 endpoints (e.g. Polycom).
-- Allows dialing a 3-10 digit number to land directly in a persistent room without
-- waiting for host admission or manual lobby approval.

CREATE TABLE IF NOT EXISTS room_numbers (
    number VARCHAR(10) PRIMARY KEY CHECK (number ~ '^[0-9]{3,10}$'),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    meeting_code VARCHAR(30) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    pin_hash TEXT,
    auto_admit BOOLEAN NOT NULL DEFAULT true,
    max_participants INTEGER NOT NULL DEFAULT 100,
    encryption VARCHAR(20) NOT NULL DEFAULT 'optional' CHECK (encryption IN ('required', 'optional')),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_room_numbers_code ON room_numbers (meeting_code);
CREATE INDEX IF NOT EXISTS idx_room_numbers_tenant ON room_numbers (tenant_id);

CREATE TABLE IF NOT EXISTS room_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    model VARCHAR(100) NOT NULL DEFAULT 'Polycom',
    protocol VARCHAR(10) NOT NULL DEFAULT 'sip' CHECK (protocol IN ('sip', 'h323')),
    extension VARCHAR(10) UNIQUE NOT NULL CHECK (extension ~ '^[0-9]{3,10}$'),
    sip_password_hash TEXT,
    sip_password_encrypted TEXT,
    allowed_cidr VARCHAR(50),
    default_room_number VARCHAR(10) REFERENCES room_numbers(number) ON DELETE SET NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_room_devices_ext ON room_devices (extension);
CREATE INDEX IF NOT EXISTS idx_room_devices_tenant ON room_devices (tenant_id);

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qsvc_meeting_service') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON room_numbers TO qsvc_meeting_service;
        GRANT SELECT, INSERT, UPDATE, DELETE ON room_devices TO qsvc_meeting_service;
    END IF;
END $$;

