-- Parent contact identity is additive and legacy-safe. email_hash remains the
-- only login/lookup/uniqueness value; display email is separately encrypted.
-- The dedicated PCA_PARENT_IDENTITY_ENC_KEY keyring is described in
-- parentaccount/identityContact.ts. Existing rows are not backfilled because
-- their email_hash is one-way and names/phone must never be guessed.

-- Migration 0052 originally declared the name columns with
-- utf8mb4_0900_ai_ci, outside PCA's canonical utf8mb4_bin text-column
-- policy. Normalize existing 0052 databases as well as fresh databases;
-- the change affects comparison semantics only and preserves stored values.
SET @pca_0053_first_name_collation = (
  SELECT collation_name FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'parent_accounts'
     AND column_name = 'first_name'
);
SET @pca_0053_first_name_collation_sql = IF(
  @pca_0053_first_name_collation IS NOT NULL AND @pca_0053_first_name_collation <> 'utf8mb4_bin',
  'ALTER TABLE parent_accounts MODIFY COLUMN first_name VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL',
  'SELECT 1'
);
PREPARE pca_0053_first_name_collation_stmt FROM @pca_0053_first_name_collation_sql;
EXECUTE pca_0053_first_name_collation_stmt;
DEALLOCATE PREPARE pca_0053_first_name_collation_stmt;

SET @pca_0053_last_name_collation = (
  SELECT collation_name FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'parent_accounts'
     AND column_name = 'last_name'
);
SET @pca_0053_last_name_collation_sql = IF(
  @pca_0053_last_name_collation IS NOT NULL AND @pca_0053_last_name_collation <> 'utf8mb4_bin',
  'ALTER TABLE parent_accounts MODIFY COLUMN last_name VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL',
  'SELECT 1'
);
PREPARE pca_0053_last_name_collation_stmt FROM @pca_0053_last_name_collation_sql;
EXECUTE pca_0053_last_name_collation_stmt;
DEALLOCATE PREPARE pca_0053_last_name_collation_stmt;

SET @pca_0053_email_ciphertext_exists = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'parent_accounts'
     AND column_name = 'protected_display_email_ciphertext'
);
SET @pca_0053_email_ciphertext_sql = IF(
  @pca_0053_email_ciphertext_exists = 0,
  'ALTER TABLE parent_accounts ADD COLUMN protected_display_email_ciphertext VARBINARY(1280) NULL AFTER last_name',
  'SELECT 1'
);
PREPARE pca_0053_email_ciphertext_stmt FROM @pca_0053_email_ciphertext_sql;
EXECUTE pca_0053_email_ciphertext_stmt;
DEALLOCATE PREPARE pca_0053_email_ciphertext_stmt;

SET @pca_0053_email_nonce_exists = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'parent_accounts'
     AND column_name = 'protected_display_email_nonce'
);
SET @pca_0053_email_nonce_sql = IF(
  @pca_0053_email_nonce_exists = 0,
  'ALTER TABLE parent_accounts ADD COLUMN protected_display_email_nonce BINARY(12) NULL AFTER protected_display_email_ciphertext',
  'SELECT 1'
);
PREPARE pca_0053_email_nonce_stmt FROM @pca_0053_email_nonce_sql;
EXECUTE pca_0053_email_nonce_stmt;
DEALLOCATE PREPARE pca_0053_email_nonce_stmt;

SET @pca_0053_email_tag_exists = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'parent_accounts'
     AND column_name = 'protected_display_email_auth_tag'
);
SET @pca_0053_email_tag_sql = IF(
  @pca_0053_email_tag_exists = 0,
  'ALTER TABLE parent_accounts ADD COLUMN protected_display_email_auth_tag BINARY(16) NULL AFTER protected_display_email_nonce',
  'SELECT 1'
);
PREPARE pca_0053_email_tag_stmt FROM @pca_0053_email_tag_sql;
EXECUTE pca_0053_email_tag_stmt;
DEALLOCATE PREPARE pca_0053_email_tag_stmt;

SET @pca_0053_phone_exists = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'parent_accounts'
     AND column_name = 'phone_number'
);
SET @pca_0053_phone_sql = IF(
  @pca_0053_phone_exists = 0,
  'ALTER TABLE parent_accounts ADD COLUMN phone_number VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER protected_display_email_auth_tag',
  'SELECT 1'
);
PREPARE pca_0053_phone_stmt FROM @pca_0053_phone_sql;
EXECUTE pca_0053_phone_stmt;
DEALLOCATE PREPARE pca_0053_phone_stmt;

SET @pca_0053_phone_verified_exists = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'parent_accounts'
     AND column_name = 'phone_verified_at'
);
SET @pca_0053_phone_verified_sql = IF(
  @pca_0053_phone_verified_exists = 0,
  'ALTER TABLE parent_accounts ADD COLUMN phone_verified_at DATETIME(3) NULL AFTER phone_number',
  'SELECT 1'
);
PREPARE pca_0053_phone_verified_stmt FROM @pca_0053_phone_verified_sql;
EXECUTE pca_0053_phone_verified_stmt;
DEALLOCATE PREPARE pca_0053_phone_verified_stmt;

SET @pca_0053_email_pair_check_exists = (
  SELECT COUNT(*) FROM information_schema.table_constraints
   WHERE constraint_schema = DATABASE() AND table_name = 'parent_accounts'
     AND constraint_name = 'parent_accounts_display_email_cipher_pair_check'
);
SET @pca_0053_email_pair_check_sql = IF(
  @pca_0053_email_pair_check_exists = 0,
  'ALTER TABLE parent_accounts ADD CONSTRAINT parent_accounts_display_email_cipher_pair_check CHECK ((protected_display_email_ciphertext IS NULL AND protected_display_email_nonce IS NULL AND protected_display_email_auth_tag IS NULL) OR (protected_display_email_ciphertext IS NOT NULL AND OCTET_LENGTH(protected_display_email_ciphertext) BETWEEN 1 AND 1280 AND protected_display_email_nonce IS NOT NULL AND protected_display_email_auth_tag IS NOT NULL))',
  'SELECT 1'
);
PREPARE pca_0053_email_pair_check_stmt FROM @pca_0053_email_pair_check_sql;
EXECUTE pca_0053_email_pair_check_stmt;
DEALLOCATE PREPARE pca_0053_email_pair_check_stmt;

SET @pca_0053_phone_check_exists = (
  SELECT COUNT(*) FROM information_schema.table_constraints
   WHERE constraint_schema = DATABASE() AND table_name = 'parent_accounts'
     AND constraint_name = 'parent_accounts_phone_e164_check'
);
SET @pca_0053_phone_check_sql = IF(
  @pca_0053_phone_check_exists = 0,
  'ALTER TABLE parent_accounts ADD CONSTRAINT parent_accounts_phone_e164_check CHECK (phone_number IS NULL OR REGEXP_LIKE(phone_number, ''^[+][1-9][0-9]{7,14}$''))',
  'SELECT 1'
);
PREPARE pca_0053_phone_check_stmt FROM @pca_0053_phone_check_sql;
EXECUTE pca_0053_phone_check_stmt;
DEALLOCATE PREPARE pca_0053_phone_check_stmt;

SET @pca_0053_phone_verified_check_exists = (
  SELECT COUNT(*) FROM information_schema.table_constraints
   WHERE constraint_schema = DATABASE() AND table_name = 'parent_accounts'
     AND constraint_name = 'parent_accounts_phone_verified_pair_check'
);
SET @pca_0053_phone_verified_check_sql = IF(
  @pca_0053_phone_verified_check_exists = 0,
  'ALTER TABLE parent_accounts ADD CONSTRAINT parent_accounts_phone_verified_pair_check CHECK (phone_number IS NOT NULL OR phone_verified_at IS NULL)',
  'SELECT 1'
);
PREPARE pca_0053_phone_verified_check_stmt FROM @pca_0053_phone_verified_check_sql;
EXECUTE pca_0053_phone_verified_check_stmt;
DEALLOCATE PREPARE pca_0053_phone_verified_check_stmt;
