-- PCA family-role completion (owner-approved source migration only).
--
-- Family roles are relationship-scoped.  They are deliberately not stored on
-- parent_accounts (an identity may participate in more than one family), and
-- family_member_invitations remains invitation lifecycle state rather than
-- active membership state.
--
-- IDEMPOTENCY (2026-09-21, PCA full assessment finding P1-07 / QA-11): this
-- file has two DDL statements and MySQL auto-commits per statement. This
-- migration is NOT YET APPLIED in production (which is at 0040), so it is
-- exactly the kind of file where an interrupted first application would wedge
-- the chain: the table would exist, the profile columns would not, and a naive
-- retry would die on "table already exists" before reaching the ALTER. The
-- CREATE is now `CREATE TABLE IF NOT EXISTS` and the ALTER is guarded by a
-- conditional PREPARE/EXECUTE (migration 0042's established idiom; MySQL has no
-- `ADD COLUMN IF NOT EXISTS`). The intended final schema is unchanged.
CREATE TABLE IF NOT EXISTS family_parent_memberships (
  membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  family_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  service_account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  role VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (membership_id),
  UNIQUE KEY family_parent_memberships_account_family_key (account_id, family_id),
  KEY family_parent_memberships_family_idx (family_id),
  KEY family_parent_memberships_service_account_idx (service_account_id),
  CONSTRAINT family_parent_memberships_family_fk FOREIGN KEY (family_id) REFERENCES families (family_id),
  CONSTRAINT family_parent_memberships_account_fk FOREIGN KEY (account_id) REFERENCES parent_accounts (account_id),
  CONSTRAINT family_parent_memberships_service_account_fk FOREIGN KEY (service_account_id) REFERENCES service_accounts (account_id),
  CONSTRAINT family_parent_memberships_role_check
    CHECK (role IN ('ADMINISTRATOR', 'VIEWER', 'CHILD')),
  CONSTRAINT family_parent_memberships_status_check
    CHECK (status IN ('ACTIVE', 'REVOKED'))
) ENGINE=InnoDB;

-- Signup profile metadata only.  These fields never participate in role,
-- authorization, invitation, trust, or platform-role resolution.
-- Both columns and both CHECK constraints were added by a SINGLE ALTER, and
-- MySQL 8.0 applies a multi-clause ALTER atomically, so probing for the first
-- column is a sufficient and correct guard for all four additions.
SET @pca_0043_column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'parent_accounts'
     AND column_name = 'account_type'
);
SET @pca_0043_alter_sql = IF(
  @pca_0043_column_exists = 0,
  'ALTER TABLE parent_accounts ADD COLUMN account_type VARCHAR(24) NULL, ADD COLUMN estimated_child_count INT UNSIGNED NULL, ADD CONSTRAINT parent_accounts_account_type_check CHECK (account_type IS NULL OR account_type IN (''PARENT_GUARDIAN'', ''OTHER'')), ADD CONSTRAINT parent_accounts_estimated_child_count_check CHECK (estimated_child_count IS NULL OR estimated_child_count <= 50)',
  'SELECT 1'
);
PREPARE pca_0043_stmt FROM @pca_0043_alter_sql;
EXECUTE pca_0043_stmt;
DEALLOCATE PREPARE pca_0043_stmt;
