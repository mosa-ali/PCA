-- PCA owner decision (2026-09-25): Parent authenticator recovery requires a
-- server-side 24-hour hold after password + verified-email code. The hold is
-- started once, never extended by another request, and cleared only after a
-- fresh code is verified at/after the deadline and a new authenticator is
-- enrolled. Existing TOTP remains active during the hold.

SET @pca_0050_started_exists = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'parent_mfa_state'
     AND column_name = 'recovery_hold_started_at'
);
SET @pca_0050_add_started_sql = IF(
  @pca_0050_started_exists = 0,
  'ALTER TABLE parent_mfa_state ADD COLUMN recovery_hold_started_at DATETIME(3) NULL AFTER reset_count',
  'SELECT 1'
);
PREPARE pca_0050_started_stmt FROM @pca_0050_add_started_sql;
EXECUTE pca_0050_started_stmt;
DEALLOCATE PREPARE pca_0050_started_stmt;

SET @pca_0050_expires_exists = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'parent_mfa_state'
     AND column_name = 'recovery_hold_expires_at'
);
SET @pca_0050_add_expires_sql = IF(
  @pca_0050_expires_exists = 0,
  'ALTER TABLE parent_mfa_state ADD COLUMN recovery_hold_expires_at DATETIME(3) NULL AFTER recovery_hold_started_at',
  'SELECT 1'
);
PREPARE pca_0050_expires_stmt FROM @pca_0050_add_expires_sql;
EXECUTE pca_0050_expires_stmt;
DEALLOCATE PREPARE pca_0050_expires_stmt;

SET @pca_0050_hold_check_exists = (
  SELECT COUNT(*) FROM information_schema.table_constraints
   WHERE constraint_schema = DATABASE() AND table_name = 'parent_mfa_state'
     AND constraint_name = 'parent_mfa_state_recovery_hold_check'
);
SET @pca_0050_hold_check_sql = IF(
  @pca_0050_hold_check_exists = 0,
  'ALTER TABLE parent_mfa_state ADD CONSTRAINT parent_mfa_state_recovery_hold_check CHECK ((recovery_hold_started_at IS NULL AND recovery_hold_expires_at IS NULL) OR (recovery_hold_started_at IS NOT NULL AND recovery_hold_expires_at IS NOT NULL AND recovery_hold_expires_at > recovery_hold_started_at))',
  'SELECT 1'
);
PREPARE pca_0050_hold_check_stmt FROM @pca_0050_hold_check_sql;
EXECUTE pca_0050_hold_check_stmt;
DEALLOCATE PREPARE pca_0050_hold_check_stmt;

SET @pca_0050_event_check_exists = (
  SELECT COUNT(*) FROM information_schema.table_constraints
   WHERE constraint_schema = DATABASE() AND table_name = 'parent_account_security_events'
     AND constraint_name = 'parent_account_security_events_type_check'
);
SET @pca_0050_event_check_sql = IF(
  @pca_0050_event_check_exists > 0,
  'ALTER TABLE parent_account_security_events DROP CHECK parent_account_security_events_type_check',
  'SELECT 1'
);
PREPARE pca_0050_event_check_drop_stmt FROM @pca_0050_event_check_sql;
EXECUTE pca_0050_event_check_drop_stmt;
DEALLOCATE PREPARE pca_0050_event_check_drop_stmt;
SET @pca_0050_event_check_exists = (
  SELECT COUNT(*) FROM information_schema.table_constraints
   WHERE constraint_schema = DATABASE() AND table_name = 'parent_account_security_events'
     AND constraint_name = 'parent_account_security_events_type_check'
);
SET @pca_0050_event_check_add_sql = IF(
  @pca_0050_event_check_exists = 0,
  'ALTER TABLE parent_account_security_events ADD CONSTRAINT parent_account_security_events_type_check CHECK (event_type IN (''FAMILY_PROVISIONED'', ''FIRST_LOGIN'', ''MFA_GRACE_STARTED'', ''MFA_ENROLLED'', ''MFA_LOGIN_FAILED'', ''MFA_LOCKED'', ''MFA_RECOVERY_REQUESTED'', ''MFA_RECOVERY_PENDING'', ''MFA_RECOVERY_COMPLETED'', ''MFA_RESET'', ''STEP_UP_GRANTED'', ''STEP_UP_FAILED'', ''STEP_UP_CONSUMED''))',
  'SELECT 1'
);
PREPARE pca_0050_event_check_add_stmt FROM @pca_0050_event_check_add_sql;
EXECUTE pca_0050_event_check_add_stmt;
DEALLOCATE PREPARE pca_0050_event_check_add_stmt;
