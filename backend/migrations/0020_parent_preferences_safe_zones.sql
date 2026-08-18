-- PCA-FR-094: durable parent preferences and controlled email destination.
-- PCA-FR-063 / PCA-FR-091 / PCA-FR-135: safe-zone policy envelopes. The
-- service stores only opaque routing/version metadata and an encrypted
-- payload. It must never hold a readable label, coordinate, radius, or
-- child-location policy.
CREATE TABLE parent_account_preferences (
  account_id VARCHAR(64) NOT NULL,
  language_code VARCHAR(2) NOT NULL DEFAULT 'en',
  email_alerts_enabled TINYINT(1) NOT NULL DEFAULT 1,
  push_requests_enabled TINYINT(1) NOT NULL DEFAULT 1,
  email_destination VARCHAR(320) NULL,
  email_destination_state VARCHAR(16) NOT NULL DEFAULT 'UNVERIFIED',
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (account_id),
  CONSTRAINT parent_account_preferences_language_check CHECK (language_code IN ('en', 'ar')),
  CONSTRAINT parent_account_preferences_email_check CHECK (email_alerts_enabled IN (0, 1)),
  CONSTRAINT parent_account_preferences_push_check CHECK (push_requests_enabled IN (0, 1)),
  CONSTRAINT parent_account_preferences_email_state_check CHECK (email_destination_state IN ('UNVERIFIED', 'VERIFIED'))
);

CREATE TABLE safe_zones (
  zone_id VARCHAR(64) NOT NULL,
  family_id VARCHAR(128) NOT NULL,
  recipient_endpoint_id VARCHAR(128) NOT NULL,
  ciphertext MEDIUMBLOB NOT NULL,
  nonce VARBINARY(64) NOT NULL,
  key_epoch INT UNSIGNED NOT NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  delivery_state VARCHAR(24) NOT NULL DEFAULT 'PENDING_OFFLINE',
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (zone_id),
  KEY safe_zones_family_recipient_idx (family_id, recipient_endpoint_id),
  CONSTRAINT safe_zones_ciphertext_check CHECK (OCTET_LENGTH(ciphertext) BETWEEN 1 AND 65535),
  CONSTRAINT safe_zones_nonce_check CHECK (OCTET_LENGTH(nonce) BETWEEN 12 AND 64),
  CONSTRAINT safe_zones_key_epoch_check CHECK (key_epoch > 0),
  CONSTRAINT safe_zones_delivery_state_check CHECK (delivery_state IN ('PENDING_OFFLINE', 'READY'))
);
