-- Real persistence for the five domain-only backends already implemented
-- and reviewed in-memory: invitation, device/public-key directory, opaque
-- relay, opaque recovery, and release metadata.
--
-- The migration-0001 `devices`, `device_public_keys`, and `release_metadata`
-- tables were pre-domain scaffolding with no application code depending on
-- their exact shape (only migration-0001's own privacy test inspects that
-- file directly, unaffected by this one). They are replaced here with the
-- shapes the actual domain services and repositories require.
--
-- As with 0001: all identifiers are opaque application references; no URL,
-- title, search, location, app-usage, policy, Admin PIN, private device
-- key, FDEK, recovery-secret, camera, or face data may be added here.
--
-- Opaque TEXT identifiers (family_id, sender/recipient device ids) are
-- bounded to the domain layer's MAX_OPAQUE_ID_LENGTH (see
-- src/*/policy.ts) rather than constrained to a specific ID format: the
-- domain's own isPlausibleOpaqueId contract deliberately accepts any
-- bounded non-empty string, not only UUIDs, so the schema enforces the
-- same bound rather than a stricter shape that would contradict it.

DROP TABLE IF EXISTS device_public_keys;
DROP TABLE IF EXISTS devices;
DROP TABLE IF EXISTS release_metadata;

-- ---------------------------------------------------------------------
-- Enrollment invitations
-- ---------------------------------------------------------------------

CREATE TABLE enrollment_invitations (
  invitation_id UUID PRIMARY KEY,
  family_id TEXT NOT NULL CHECK (char_length(family_id) BETWEEN 1 AND 128),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  platform TEXT NOT NULL CHECK (platform IN ('ANDROID', 'IOS')),
  requested_protection_mode TEXT NOT NULL
    CHECK (requested_protection_mode IN ('ANDROID_STANDARD', 'ANDROID_PROTECTED', 'IOS_STANDARD')),
  status TEXT NOT NULL CHECK (status IN ('CREATED', 'OPENED', 'REDEEMED', 'REVOKED')),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  opened_at TIMESTAMPTZ,
  redeemed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX enrollment_invitations_family_id_idx ON enrollment_invitations (family_id);

-- ---------------------------------------------------------------------
-- Device identity / public-key directory
-- ---------------------------------------------------------------------

CREATE TABLE devices (
  device_id UUID PRIMARY KEY,
  family_id TEXT NOT NULL CHECK (char_length(family_id) BETWEEN 1 AND 128),
  platform TEXT NOT NULL CHECK (platform IN ('ANDROID', 'IOS')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  created_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX devices_family_id_idx ON devices (family_id);

CREATE TABLE device_public_keys (
  device_id UUID NOT NULL REFERENCES devices (device_id),
  key_id UUID NOT NULL,
  public_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  created_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (device_id, key_id)
);

CREATE INDEX device_public_keys_device_id_idx ON device_public_keys (device_id);

-- A public key may never be registered more than once, full stop -- not
-- merely "not twice while ACTIVE". Revoked key material is permanently
-- tombstoned: rotation means generating genuinely new key material, so a
-- previously revoked public key can never later become ACTIVE again under
-- any device or key id. A plain (non-partial) UNIQUE index enforces this
-- across the row's entire lifetime, regardless of status.
--
-- This index is a single namespace shared across ALL families. That is
-- privacy-safe only because device keys are required to be freshly,
-- independently random per device (never derived from anything
-- identifying) -- so a collision can only mean "this exact key value was
-- genuinely reused," never a meaningful cross-family relationship. A
-- DUPLICATE_KEY rejection is identical (same code, same generic message)
-- whether the collision is against an ACTIVE key, a revoked key in the
-- same family, or a revoked key in a different family -- the caller can
-- never distinguish which case occurred.
CREATE UNIQUE INDEX device_public_keys_public_key_idx
  ON device_public_keys (public_key);

-- ---------------------------------------------------------------------
-- Opaque store-and-forward relay
-- ---------------------------------------------------------------------

CREATE TABLE relay_envelopes (
  message_id TEXT PRIMARY KEY CHECK (char_length(message_id) BETWEEN 1 AND 128),
  family_id TEXT NOT NULL CHECK (char_length(family_id) BETWEEN 1 AND 128),
  sender_device_id TEXT NOT NULL CHECK (char_length(sender_device_id) BETWEEN 1 AND 128),
  recipient_device_id TEXT NOT NULL CHECK (char_length(recipient_device_id) BETWEEN 1 AND 128),
  ciphertext BYTEA NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('QUEUED', 'ACKNOWLEDGED')),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  acknowledged_at TIMESTAMPTZ
);

-- Serves recipient-scoped queued-envelope listing; never indexes ciphertext content.
CREATE INDEX relay_envelopes_recipient_state_idx
  ON relay_envelopes (recipient_device_id, state, expires_at);

-- ---------------------------------------------------------------------
-- Opaque family recovery envelope
-- ---------------------------------------------------------------------

CREATE TABLE recovery_envelopes (
  family_id TEXT PRIMARY KEY CHECK (char_length(family_id) BETWEEN 1 AND 128),
  ciphertext BYTEA NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- ---------------------------------------------------------------------
-- Signed release/model/rule metadata
-- ---------------------------------------------------------------------

CREATE TABLE release_packages (
  release_id TEXT PRIMARY KEY CHECK (char_length(release_id) BETWEEN 1 AND 256),
  package_type TEXT NOT NULL CHECK (package_type IN ('ANDROID_APP', 'IOS_APP', 'MODEL_PACKAGE', 'RULE_PACKAGE')),
  platform TEXT NOT NULL CHECK (platform IN ('ANDROID', 'IOS', 'SHARED')),
  version TEXT NOT NULL CHECK (version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'),
  artifact_digest TEXT NOT NULL CHECK (artifact_digest ~ '^[0-9a-f]{64}$'),
  artifact_size_bytes BIGINT NOT NULL CHECK (artifact_size_bytes > 0),
  signing_key_id TEXT NOT NULL CHECK (char_length(signing_key_id) BETWEEN 1 AND 128),
  signed_metadata BYTEA NOT NULL,
  minimum_supported_version TEXT
    CHECK (minimum_supported_version IS NULL OR minimum_supported_version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'),
  state TEXT NOT NULL CHECK (state IN ('PUBLISHED', 'RETIRED')),
  published_at TIMESTAMPTZ NOT NULL,
  retired_at TIMESTAMPTZ,
  UNIQUE (package_type, platform, version)
);

-- version_major/minor/patch mirror the `version` string as integers so the
-- "only advance forward" rule can be enforced as a single atomic UPSERT
-- (tuple comparison in the ON CONFLICT ... WHERE clause) instead of a
-- SELECT ... FOR UPDATE, which cannot lock a row that does not exist yet --
-- the exact gap that let a low-version first-publish race a high-version
-- first-publish and non-deterministically win.
CREATE TABLE release_current_pointers (
  package_type TEXT NOT NULL,
  platform TEXT NOT NULL,
  version TEXT NOT NULL,
  version_major INTEGER NOT NULL CHECK (version_major >= 0),
  version_minor INTEGER NOT NULL CHECK (version_minor >= 0),
  version_patch INTEGER NOT NULL CHECK (version_patch >= 0),
  is_explicit_rollback BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (package_type, platform)
);
