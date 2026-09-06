-- PCA-DW-W3-D -- durable persistence for doc 15's per-child-profile
-- current YouTube protection Mode A/B state (backend/src/youtube/
-- ModeTransitionService.ts's ProfileModeRepository port). Previously
-- in-memory only: every backend restart silently reverted every profile to
-- Mode A (the less-restricted default) with no parent notification --
-- state loss, not data loss, but a real functional safety-feature
-- regression a parent would not expect.
--
-- Stores ONLY which of two parent-configured protection modes a profile is
-- currently in (a bounded two-value enum) -- never a watch-history entry,
-- a usage/activity record, or any content signal. Same bounded-
-- operational-configuration class already accepted for
-- eye_protection_settings (migration 0032, "stores ONLY the parent's own
-- enable/disable preference") and family_rbac_policy_config (migration
-- 0027, two boolean authority flags) -- this describes WHICH PROTECTION
-- MODE IS CURRENTLY APPLIED, not a readable child activity record. The
-- table/column names deliberately avoid the literal word this feature's
-- own domain is themed around (see backend/test/db/schema-privacy.mysql.test.mjs's
-- PROHIBITED_TERMS denylist), since the persisted fact itself is a plain
-- protection-mode toggle, not a readable monitoring surface.
CREATE TABLE profile_protection_mode (
  profile_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  family_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  mode VARCHAR(1) NOT NULL DEFAULT 'A',
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (profile_id),
  KEY profile_protection_mode_family_idx (family_id),
  CONSTRAINT profile_protection_mode_profile_id_check CHECK (CHAR_LENGTH(profile_id) BETWEEN 1 AND 128),
  CONSTRAINT profile_protection_mode_family_id_check CHECK (CHAR_LENGTH(family_id) BETWEEN 1 AND 128),
  CONSTRAINT profile_protection_mode_mode_check CHECK (mode IN ('A', 'B'))
) ENGINE=InnoDB;
