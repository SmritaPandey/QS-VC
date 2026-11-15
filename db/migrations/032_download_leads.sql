-- Voluntary sales follow-up details, separate from accounts and download entitlements.
CREATE TABLE download_leads (
    id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL CHECK (length(trim(name)) > 0),
    email VARCHAR(255) NOT NULL,
    platform VARCHAR(32) NOT NULL CHECK (platform IN (
        'linux-installer', 'linux-package', 'vmware-ova', 'hyperv-vhdx', 'kvm-qcow2',
        'windows-server', 'windows', 'macos-arm64', 'macos-x64', 'linux-x64'
    )),
    consent BOOLEAN NOT NULL CHECK (consent = true),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX download_leads_created_idx ON download_leads (created_at DESC, id DESC);
REVOKE ALL ON download_leads FROM PUBLIC;
GRANT SELECT, INSERT ON download_leads TO qsvc_auth_service;
