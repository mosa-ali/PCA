-- Owner policy (2026-10-01): five failed Parent password authentications in
-- one rolling 15-minute window lock password login for one hour. Keep these
-- account-level counters separate from the TOTP/recovery-code budgets in
-- parent_mfa_state and the per-code attempt counters.
-- Additive only; existing Parent rows begin with a clear failure state.
-- Each DDL operation is independently guarded so migrate.mjs can retry this
-- file safely after an interruption between MySQL's auto-committed DDL steps.

SET @pca_0061_count_exists = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'parent_accounts'
     AND column_name = 'password_failed_attempt_count'
);
SET @pca_0061_add_count_sql = IF(
  @pca_0061_count_exists = 0,
  'ALTER TABLE parent_accounts ADD COLUMN password_failed_attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER estimated_child_count',
  'SELECT 1'
);
PREPARE pca_0061_count_stmt FROM @pca_0061_add_count_sql;
EXECUTE pca_0061_count_stmt;
DEALLOCATE PREPARE pca_0061_count_stmt;

SET @pca_0061_window_exists = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'parent_accounts'
     AND column_name = 'password_failure_window_started_at'
);
SET @pca_0061_add_window_sql = IF(
  @pca_0061_window_exists = 0,
  'ALTER TABLE parent_accounts ADD COLUMN password_failure_window_started_at DATETIME(3) NULL AFTER password_failed_attempt_count',
  'SELECT 1'
);
PREPARE pca_0061_window_stmt FROM @pca_0061_add_window_sql;
EXECUTE pca_0061_window_stmt;
DEALLOCATE PREPARE pca_0061_window_stmt;

SET @pca_0061_locked_until_exists = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'parent_accounts'
     AND column_name = 'password_login_locked_until'
);
SET @pca_0061_add_locked_until_sql = IF(
  @pca_0061_locked_until_exists = 0,
  'ALTER TABLE parent_accounts ADD COLUMN password_login_locked_until DATETIME(3) NULL AFTER password_failure_window_started_at',
  'SELECT 1'
);
PREPARE pca_0061_locked_until_stmt FROM @pca_0061_add_locked_until_sql;
EXECUTE pca_0061_locked_until_stmt;
DEALLOCATE PREPARE pca_0061_locked_until_stmt;

SET @pca_0061_check_exists = (
  SELECT COUNT(*) FROM information_schema.table_constraints
   WHERE constraint_schema = DATABASE() AND table_name = 'parent_accounts'
     AND constraint_name = 'parent_accounts_password_failure_state_check'
);
SET @pca_0061_add_check_sql = IF(
  @pca_0061_check_exists = 0,
  'ALTER TABLE parent_accounts ADD CONSTRAINT parent_accounts_password_failure_state_check CHECK ((password_failed_attempt_count = 0 AND password_failure_window_started_at IS NULL AND password_login_locked_until IS NULL) OR (password_failed_attempt_count BETWEEN 1 AND 4 AND password_failure_window_started_at IS NOT NULL AND password_login_locked_until IS NULL) OR (password_failed_attempt_count = 5 AND password_failure_window_started_at IS NOT NULL AND password_login_locked_until IS NOT NULL))',
  'SELECT 1'
);
PREPARE pca_0061_check_stmt FROM @pca_0061_add_check_sql;
EXECUTE pca_0061_check_stmt;
DEALLOCATE PREPARE pca_0061_check_stmt;
