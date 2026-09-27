-- MySQL 8.4.9 Azure preserved these two CHECK literals with the server's
-- cp850 connection introducer. Restore the canonical utf8mb4 CHECK literals
-- used by the migration-created schema. This changes only stored expression
-- character-set metadata; allowed values and the lowercase-hex rule are
-- unchanged.

SET @pca_0059_previous_character_set_connection = @@character_set_connection;
SET character_set_connection = utf8mb4;

SET @pca_0059_purpose_clause = (
  SELECT check_clause FROM information_schema.check_constraints cc
   JOIN information_schema.table_constraints tc
     ON tc.constraint_schema = cc.constraint_schema
    AND tc.constraint_name = cc.constraint_name
   WHERE tc.constraint_schema = DATABASE()
     AND tc.table_name = 'parent_mfa_enrollment_tickets'
     AND tc.constraint_name = 'parent_mfa_enrollment_tickets_purpose_check'
   LIMIT 1
);
SET @pca_0059_purpose_sql = IF(
  @pca_0059_purpose_clause IS NULL,
  'ALTER TABLE parent_mfa_enrollment_tickets ADD CONSTRAINT parent_mfa_enrollment_tickets_purpose_check CHECK (purpose IN (''MFA_SETUP_REQUIRED'', ''MFA_RECOVERY''))',
  IF(
    LOCATE('_ascii', @pca_0059_purpose_clause) > 0,
    'SELECT 1',
    'ALTER TABLE parent_mfa_enrollment_tickets DROP CHECK parent_mfa_enrollment_tickets_purpose_check, ADD CONSTRAINT parent_mfa_enrollment_tickets_purpose_check CHECK (purpose IN (''MFA_SETUP_REQUIRED'', ''MFA_RECOVERY''))'
  )
);
PREPARE pca_0059_purpose_stmt FROM @pca_0059_purpose_sql;
EXECUTE pca_0059_purpose_stmt;
DEALLOCATE PREPARE pca_0059_purpose_stmt;

SET @pca_0059_hash_clause = (
  SELECT check_clause FROM information_schema.check_constraints cc
   JOIN information_schema.table_constraints tc
     ON tc.constraint_schema = cc.constraint_schema
    AND tc.constraint_name = cc.constraint_name
   WHERE tc.constraint_schema = DATABASE()
     AND tc.table_name = 'parent_mfa_enrollment_tickets'
     AND tc.constraint_name = 'parent_mfa_enrollment_tickets_hash_check'
   LIMIT 1
);
SET @pca_0059_hash_sql = IF(
  @pca_0059_hash_clause IS NULL,
  'ALTER TABLE parent_mfa_enrollment_tickets ADD CONSTRAINT parent_mfa_enrollment_tickets_hash_check CHECK (REGEXP_LIKE(token_hash, _utf8mb4''^[0-9a-f]{64}$''))',
  IF(
    LOCATE('_utf8mb4', @pca_0059_hash_clause) > 0,
    'SELECT 1',
    'ALTER TABLE parent_mfa_enrollment_tickets DROP CHECK parent_mfa_enrollment_tickets_hash_check, ADD CONSTRAINT parent_mfa_enrollment_tickets_hash_check CHECK (REGEXP_LIKE(token_hash, _utf8mb4''^[0-9a-f]{64}$''))'
  )
);
PREPARE pca_0059_hash_stmt FROM @pca_0059_hash_sql;
EXECUTE pca_0059_hash_stmt;
DEALLOCATE PREPARE pca_0059_hash_stmt;

SET character_set_connection = @pca_0059_previous_character_set_connection;
SET @pca_0059_previous_character_set_connection = NULL;
