-- PCA-DEC-020-R2 SOURCE-ONLY. Production execution is not authorized by this lane.
-- A genesis authorization is a short-lived, one-time, exact-session binding.
-- Only a keyed code hash and a hash of AuthService's opaque sessionId are stored.
--
-- IDEMPOTENCY (2026-09-21, PCA full assessment finding P1-07 / QA-11): this file
-- has two DDL statements and MySQL auto-commits per statement, so an
-- interruption between them previously left the table created but the column
-- missing, and a naive retry died on "table already exists" before reaching the
-- ALTER -- wedging the migration chain. The CREATE is now
-- `CREATE TABLE IF NOT EXISTS` and the ALTER is guarded by a conditional
-- PREPARE/EXECUTE (migration 0042's established idiom; MySQL has no
-- `ADD COLUMN IF NOT EXISTS`). The intended final schema is unchanged.

CREATE TABLE IF NOT EXISTS parent_genesis_step_up_authorizations (
  authorization_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  service_account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_id_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operation VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  verified_at DATETIME(3) NULL,
  consumed_at DATETIME(3) NULL,
  PRIMARY KEY (authorization_id),
  KEY parent_genesis_step_up_session_idx (account_id, service_account_id, session_id_hash, created_at),
  CONSTRAINT parent_genesis_step_up_account_fk FOREIGN KEY (account_id) REFERENCES parent_accounts (account_id),
  CONSTRAINT parent_genesis_step_up_service_account_fk FOREIGN KEY (service_account_id) REFERENCES service_accounts (account_id),
  CONSTRAINT parent_genesis_step_up_operation_check CHECK (operation = 'FAMILY_GENESIS'),
  CONSTRAINT parent_genesis_step_up_session_hash_check CHECK (CHAR_LENGTH(session_id_hash) = 64),
  CONSTRAINT parent_genesis_step_up_code_hash_check CHECK (CHAR_LENGTH(code_hash) = 64),
  CONSTRAINT parent_genesis_step_up_expiry_check CHECK (expires_at > created_at)
) ENGINE=InnoDB;

-- The column, its index and its FK were added by a SINGLE ALTER below, and
-- MySQL 8.0 applies a multi-clause ALTER atomically, so probing for the column
-- is a sufficient and correct guard for all three additions.
SET @pca_0045_column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'parent_genesis_challenges'
     AND column_name = 'genesis_authorization_id'
);
SET @pca_0045_alter_sql = IF(
  @pca_0045_column_exists = 0,
  'ALTER TABLE parent_genesis_challenges ADD COLUMN genesis_authorization_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER candidate_platform, ADD KEY parent_genesis_challenges_authorization_idx (genesis_authorization_id), ADD CONSTRAINT parent_genesis_challenges_authorization_fk FOREIGN KEY (genesis_authorization_id) REFERENCES parent_genesis_step_up_authorizations (authorization_id)',
  'SELECT 1'
);
PREPARE pca_0045_stmt FROM @pca_0045_alter_sql;
EXECUTE pca_0045_stmt;
DEALLOCATE PREPARE pca_0045_stmt;
