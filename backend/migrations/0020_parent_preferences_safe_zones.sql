-- PCA-FR-094 / PCA-FR-023: durable parent preferences and family-scoped
-- safe-zone policy metadata. This migration deliberately stores no message
-- payloads, movement history, or readable child activity.
CREATE TABLE parent_account_preferences (
  account_id VARCHAR(64) NOT NULL,
  language_code VARCHAR(2) NOT NULL DEFAULT 'en',
  email_alerts_enabled TINYINT(1) NOT NULL DEFAULT 1,
  push_requests_enabled TINYINT(1) NOT NULL DEFAULT 1,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (account_id),
  CONSTRAINT parent_account_preferences_language_check CHECK (language_code IN ('en', 'ar')),
  CONSTRAINT parent_account_preferences_email_check CHECK (email_alerts_enabled IN (0, 1)),
  CONSTRAINT parent_account_preferences_push_check CHECK (push_requests_enabled IN (0, 1))
);

CREATE TABLE safe_zones (
  zone_id VARCHAR(64) NOT NULL,
  family_id VARCHAR(128) NOT NULL,
  child_profile_id VARCHAR(128) NOT NULL,
  label VARCHAR(80) NOT NULL,
  latitude DECIMAL(9, 6) NOT NULL,
  longitude DECIMAL(9, 6) NOT NULL,
  radius_meters INT UNSIGNED NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  delivery_state VARCHAR(24) NOT NULL DEFAULT 'PENDING_OFFLINE',
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (zone_id),
  KEY safe_zones_family_child_idx (family_id, child_profile_id),
  CONSTRAINT safe_zones_label_check CHECK (CHAR_LENGTH(label) BETWEEN 1 AND 80),
  CONSTRAINT safe_zones_latitude_check CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT safe_zones_longitude_check CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT safe_zones_radius_check CHECK (radius_meters BETWEEN 50 AND 100000),
  CONSTRAINT safe_zones_enabled_check CHECK (enabled IN (0, 1)),
  CONSTRAINT safe_zones_delivery_state_check CHECK (delivery_state IN ('PENDING_OFFLINE', 'READY'))
);
