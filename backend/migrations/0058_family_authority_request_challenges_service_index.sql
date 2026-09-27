-- The canonical schema declares this single-column index for service-account
-- lookups, in addition to the composite scope index. Migration 0044 created
-- only the composite index, so migration-built databases drifted from the
-- canonical schema. Add the missing index idempotently; no rows are changed.
-- A same-named index with the wrong shape deliberately reaches CREATE INDEX
-- and fails with a duplicate-name error rather than being accepted as valid.
SET @pca_0058_index_exists = (
  SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE()
     AND table_name = 'family_authority_request_challenges'
     AND index_name = 'family_authority_request_challenges_service_fk'
);
SET @pca_0058_index_shape_matches = (
  SELECT CASE
    WHEN COUNT(*) = 1
     AND SUM(non_unique = 1 AND seq_in_index = 1 AND column_name = 'service_account_id') = 1
    THEN 1 ELSE 0
  END
    FROM information_schema.statistics
   WHERE table_schema = DATABASE()
     AND table_name = 'family_authority_request_challenges'
     AND index_name = 'family_authority_request_challenges_service_fk'
);
SET @pca_0058_create_index_sql = IF(
  @pca_0058_index_exists = 0,
  'CREATE INDEX family_authority_request_challenges_service_fk ON family_authority_request_challenges (service_account_id)',
  IF(
    @pca_0058_index_shape_matches = 1,
    'SELECT 1',
    'CREATE INDEX family_authority_request_challenges_service_fk ON family_authority_request_challenges (service_account_id)'
  )
);
PREPARE pca_0058_create_index_stmt FROM @pca_0058_create_index_sql;
EXECUTE pca_0058_create_index_stmt;
DEALLOCATE PREPARE pca_0058_create_index_stmt;
