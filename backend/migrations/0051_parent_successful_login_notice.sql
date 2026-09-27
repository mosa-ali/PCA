-- Add an audit event for every successful Parent sign-in. Security notices
-- are separately queued through the encrypted email outbox.

SET @pca_0051_event_check_exists = (
  SELECT COUNT(*) FROM information_schema.table_constraints
   WHERE constraint_schema = DATABASE() AND table_name = 'parent_account_security_events'
     AND constraint_name = 'parent_account_security_events_type_check'
);
SET @pca_0051_event_check_sql = IF(
  @pca_0051_event_check_exists > 0,
  'ALTER TABLE parent_account_security_events DROP CHECK parent_account_security_events_type_check',
  'SELECT 1'
);
PREPARE pca_0051_event_check_drop_stmt FROM @pca_0051_event_check_sql;
EXECUTE pca_0051_event_check_drop_stmt;
DEALLOCATE PREPARE pca_0051_event_check_drop_stmt;

SET @pca_0051_event_check_exists = (
  SELECT COUNT(*) FROM information_schema.table_constraints
   WHERE constraint_schema = DATABASE() AND table_name = 'parent_account_security_events'
     AND constraint_name = 'parent_account_security_events_type_check'
);
SET @pca_0051_event_check_add_sql = IF(
  @pca_0051_event_check_exists = 0,
  'ALTER TABLE parent_account_security_events ADD CONSTRAINT parent_account_security_events_type_check CHECK (event_type IN (''FAMILY_PROVISIONED'', ''FIRST_LOGIN'', ''PARENT_LOGIN_SUCCESS'', ''MFA_GRACE_STARTED'', ''MFA_ENROLLED'', ''MFA_LOGIN_FAILED'', ''MFA_LOCKED'', ''MFA_RECOVERY_REQUESTED'', ''MFA_RECOVERY_PENDING'', ''MFA_RECOVERY_COMPLETED'', ''MFA_RESET'', ''STEP_UP_GRANTED'', ''STEP_UP_FAILED'', ''STEP_UP_CONSUMED''))',
  'SELECT 1'
);
PREPARE pca_0051_event_check_add_stmt FROM @pca_0051_event_check_add_sql;
EXECUTE pca_0051_event_check_add_stmt;
DEALLOCATE PREPARE pca_0051_event_check_add_stmt;
