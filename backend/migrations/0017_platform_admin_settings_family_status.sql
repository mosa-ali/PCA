-- PCA-ADD-PA-043/044 (Writer65): the remaining Platform Administration
-- settings categories -- branding/support metadata, payment-provider
-- configuration-by-reference, notification settings, maintenance-mode
-- control, and Platform Administration/Billing feature flags -- plus
-- PCA-ADD-PA-017/020's family-account suspend/reactivate action, whose
-- absence AccountsReadModel.ts's header (`ACCOUNT_STATUS_MODEL_GAP`)
-- explicitly documents and defers to this migration's design.
--
-- SETTINGS STORAGE: a single generic `platform_admin_settings` key/value
-- table, not five bespoke tables -- every category's value is small,
-- admin-authored, JSON-shaped configuration (never family activity, never
-- a bulk/relational dataset), so one settings row per logical key is the
-- right grain (mirrors `commercialmaintenance`'s own single-row config
-- table precedent, generalized to many independently-versioned keys).
-- `is_sensitive` is set once at row-creation time by the registering route
-- (never client-supplied per write) -- PCA-ADD-PA-044's write-only/masked
-- rule is enforced at the application layer (settingsRoutes.ts never
-- selects `value_json` back out for a sensitive key), but `is_sensitive`
-- itself is also DB-recorded so a future reader of this table without the
-- application layer's own hardcoded category list still can't
-- accidentally treat a sensitive row as safe to display.
CREATE TABLE platform_admin_settings (
  setting_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  category VARCHAR(32) NOT NULL,
  value_json TEXT NOT NULL,
  is_sensitive TINYINT(1) NOT NULL DEFAULT 0,
  -- Only ever populated for is_sensitive=1 rows -- a masked/display-safe
  -- label the admin supplies at write time (identical convention to
  -- `settlement_accounts.display_label`, migration 0015), e.g. "Stripe
  -- (****4242)". Never derived from `value_json` by this schema or any
  -- application code.
  masked_display VARCHAR(128) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by_admin_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (setting_key),
  KEY platform_admin_settings_category_idx (category),
  CONSTRAINT platform_admin_settings_updated_by_fk FOREIGN KEY (updated_by_admin_id) REFERENCES platform_admin_accounts (admin_id),
  CONSTRAINT platform_admin_settings_category_check CHECK (category IN ('BRANDING', 'PAYMENT_PROVIDER', 'NOTIFICATION', 'MAINTENANCE', 'FEATURE_FLAG')),
  CONSTRAINT platform_admin_settings_key_check CHECK (CHAR_LENGTH(setting_key) BETWEEN 1 AND 128),
  CONSTRAINT platform_admin_settings_masked_display_check CHECK (
    (is_sensitive = 1 AND masked_display IS NOT NULL AND CHAR_LENGTH(masked_display) BETWEEN 1 AND 128)
    OR (is_sensitive = 0 AND masked_display IS NULL)
  )
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Family-account status (PCA-ADD-PA-017/020's narrowest real slice):
-- ADDITIVE nullable-with-default column on the existing `families` table --
-- no other column/table touched. Defaults every existing and future row to
-- 'ACTIVE' so this is a pure capability addition, never a behavior change
-- for any row that has not been explicitly suspended by a Platform Admin
-- action. `suspended_at`/`suspended_by_admin_id`/`suspension_reason` follow
-- the exact same "populated together, only together" pairing discipline as
-- `settlement_batches.resolution_reason` (migration 0015) and
-- `complimentary_entitlement_grants` (migration 0014).
ALTER TABLE families
  ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' AFTER family_reference_hash,
  ADD COLUMN suspended_at DATETIME(3) NULL,
  ADD COLUMN suspended_by_admin_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN suspension_reason VARCHAR(500) NULL,
  ADD CONSTRAINT families_status_check CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  ADD CONSTRAINT families_suspended_by_fk FOREIGN KEY (suspended_by_admin_id) REFERENCES platform_admin_accounts (admin_id),
  ADD CONSTRAINT families_suspension_pair_check CHECK (
    (status = 'SUSPENDED' AND suspended_at IS NOT NULL AND suspended_by_admin_id IS NOT NULL AND suspension_reason IS NOT NULL)
    OR (status = 'ACTIVE' AND suspended_at IS NULL AND suspended_by_admin_id IS NULL AND suspension_reason IS NULL)
  );

CREATE INDEX families_status_idx ON families (status);
