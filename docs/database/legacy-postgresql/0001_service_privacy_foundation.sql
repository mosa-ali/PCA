-- PCA central-service privacy boundary. All identifiers are opaque application
-- references; no activity, policy, location, PIN, private key, FDEK, recovery
-- secret, URL, title, search query, or readable child data may be added here.

CREATE TABLE schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE service_accounts (
  account_id UUID PRIMARY KEY,
  account_reference_hash BYTEA NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  disabled_at TIMESTAMPTZ
);

CREATE TABLE families (
  family_id UUID PRIMARY KEY,
  family_reference_hash BYTEA NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE devices (
  device_id UUID PRIMARY KEY,
  family_id UUID NOT NULL REFERENCES families(family_id),
  device_reference_hash BYTEA NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('ANDROID', 'IOS')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE device_public_keys (
  device_id UUID NOT NULL REFERENCES devices(device_id),
  key_id UUID NOT NULL,
  public_key BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (device_id, key_id)
);

CREATE TABLE licenses (
  license_id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES service_accounts(account_id),
  license_reference_hash BYTEA NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'EXPIRED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ
);

CREATE TABLE release_metadata (
  release_id UUID PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('ANDROID', 'IOS')),
  version TEXT NOT NULL,
  artifact_digest TEXT NOT NULL,
  signed_metadata BYTEA NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (platform, version)
);

CREATE TABLE security_audit_metadata (
  event_id UUID PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('ACCOUNT_DISABLED', 'DEVICE_REVOKED', 'KEY_REVOKED')),
  actor_reference_hash BYTEA,
  subject_reference_hash BYTEA,
  correlation_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
