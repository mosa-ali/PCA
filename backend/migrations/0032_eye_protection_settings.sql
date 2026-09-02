-- PCA eye-protection reminders: a per-child, parent-controlled opt-in/opt-out
-- toggle for an on-device, reminder-only break prompt. This table stores
-- ONLY the parent's own enable/disable preference -- never a sensor reading,
-- a near/far proximity classification, a distance value, or any camera
-- signal of any kind (that stays entirely on-device and is never
-- transmitted, per the feature's own privacy design). Same bounded-
-- operational-configuration class already accepted for
-- parent_account_preferences (migration 0020, e.g. email_alerts_enabled/
-- push_requests_enabled) and family_rbac_policy_config (migration 0027,
-- two boolean authority flags) -- it describes WHETHER A REMINDER FEATURE
-- IS ON, not a readable child activity record, a schedule/screen-time
-- policy document, or any other family-monitoring surface those two
-- precedents were themselves reviewed against.
CREATE TABLE eye_protection_settings (
  child_profile_id VARCHAR(128) NOT NULL,
  family_id VARCHAR(128) NOT NULL,
  reminders_enabled TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (child_profile_id),
  KEY eye_protection_settings_family_idx (family_id),
  CONSTRAINT eye_protection_settings_reminders_enabled_check CHECK (reminders_enabled IN (0, 1))
);
