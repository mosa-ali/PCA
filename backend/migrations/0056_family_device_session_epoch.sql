-- A family status transition invalidates all already-issued device sessions,
-- including when the family is later reactivated. Existing families start at
-- epoch 1; session records remain process-local and no personal data changes.
SET @pca_0056_epoch_exists = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'families'
     AND column_name = 'device_session_epoch'
);
SET @pca_0056_add_epoch_sql = IF(
  @pca_0056_epoch_exists = 0,
  'ALTER TABLE families ADD COLUMN device_session_epoch INT UNSIGNED NOT NULL DEFAULT 1 AFTER status',
  'SELECT 1'
);
PREPARE pca_0056_epoch_stmt FROM @pca_0056_add_epoch_sql;
EXECUTE pca_0056_epoch_stmt;
DEALLOCATE PREPARE pca_0056_epoch_stmt;
