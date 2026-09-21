-- One-time first activation links for real Platform Admin accounts.
-- Only a SHA-256 token digest is stored; the bearer token exists only in the
-- issuing request and encrypted email outbox payload.
--
-- IDEMPOTENCY (2026-09-21, PCA full assessment finding P1-07): this migration
-- is NOT YET APPLIED in production (which is at 0040). scripts/migrate.mjs
-- records a file as applied only after it succeeds, so a crash between MySQL
-- auto-committing this statement and the schema_migrations row being written
-- would leave the table present but unrecorded, and a retry would fail with
-- "table already exists". `IF NOT EXISTS` makes that retry a no-op.
CREATE TABLE IF NOT EXISTS platform_admin_activation_tokens (
  activation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  admin_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  purpose VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (activation_id),
  UNIQUE KEY platform_admin_activation_tokens_hash_key (token_hash),
  KEY platform_admin_activation_tokens_admin_idx (admin_id),
  CONSTRAINT platform_admin_activation_tokens_admin_fk FOREIGN KEY (admin_id) REFERENCES platform_admin_accounts (admin_id),
  CONSTRAINT platform_admin_activation_tokens_purpose_check CHECK (purpose = 'PLATFORM_ADMIN_FIRST_TIME'),
  CONSTRAINT platform_admin_activation_tokens_hash_check CHECK (token_hash REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT platform_admin_activation_tokens_expiry_check CHECK (expires_at > created_at)
) ENGINE=InnoDB;
