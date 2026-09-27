-- Parent identity profile foundation. Existing accounts remain valid with
-- NULL names; new registration validation requires both names before insert.
-- The display name is derived at read time and is not duplicated here.

SET @pca_0052_first_exists = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'parent_accounts'
     AND column_name = 'first_name'
);
SET @pca_0052_add_first_sql = IF(
  @pca_0052_first_exists = 0,
  'ALTER TABLE parent_accounts ADD COLUMN first_name VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER email_hash',
  'SELECT 1'
);
PREPARE pca_0052_first_stmt FROM @pca_0052_add_first_sql;
EXECUTE pca_0052_first_stmt;
DEALLOCATE PREPARE pca_0052_first_stmt;

SET @pca_0052_last_exists = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'parent_accounts'
     AND column_name = 'last_name'
);
SET @pca_0052_add_last_sql = IF(
  @pca_0052_last_exists = 0,
  'ALTER TABLE parent_accounts ADD COLUMN last_name VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER first_name',
  'SELECT 1'
);
PREPARE pca_0052_last_stmt FROM @pca_0052_add_last_sql;
EXECUTE pca_0052_last_stmt;
DEALLOCATE PREPARE pca_0052_last_stmt;

SET @pca_0052_names_check_exists = (
  SELECT COUNT(*) FROM information_schema.table_constraints
   WHERE constraint_schema = DATABASE() AND table_name = 'parent_accounts'
     AND constraint_name = 'parent_accounts_identity_names_check'
);
SET @pca_0052_names_check_sql = IF(
  @pca_0052_names_check_exists = 0,
  'ALTER TABLE parent_accounts ADD CONSTRAINT parent_accounts_identity_names_check CHECK ((first_name IS NULL AND last_name IS NULL) OR (first_name IS NOT NULL AND last_name IS NOT NULL AND CHAR_LENGTH(TRIM(first_name)) BETWEEN 1 AND 128 AND CHAR_LENGTH(TRIM(last_name)) BETWEEN 1 AND 128))',
  'SELECT 1'
);
PREPARE pca_0052_names_check_stmt FROM @pca_0052_names_check_sql;
EXECUTE pca_0052_names_check_stmt;
DEALLOCATE PREPARE pca_0052_names_check_stmt;
