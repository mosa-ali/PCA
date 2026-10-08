const COLUMNS = [
  'device_id',
  'signing_key_id',
  'encryption_key_id',
];

const BEFORE_OBJECTS = [
  ...COLUMNS.map((name) => `before:not_null:${name}`),
  'before:token_hash_idx',
  'before:completed_status_check',
];

const AFTER_OBJECTS = [
  ...COLUMNS.map((name) => `after:nullable:${name}`),
  'after:unique_token_hash_key',
  'after:prepared_status_check',
  'after:device_result_check',
];

/**
 * Migration 0064 is a single atomic MySQL ALTER TABLE followed by a separate
 * schema_migrations insert. If the process stops between those operations,
 * recognize the complete result and journal it instead of replaying the DDL.
 * A pre-existing partial shape is ambiguous and fails closed for repair.
 */
export async function inspectEnrollmentBootstrapAttemptResolutionMigrationState(connection) {
  const [rows] = await connection.query(
    `SELECT CONCAT('after:nullable:', column_name) AS object_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'enrollment_bootstrap_attempts'
        AND column_name IN ('device_id', 'signing_key_id', 'encryption_key_id')
        AND is_nullable = 'YES'
     UNION ALL
     SELECT CONCAT('before:not_null:', column_name) AS object_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'enrollment_bootstrap_attempts'
        AND column_name IN ('device_id', 'signing_key_id', 'encryption_key_id')
        AND is_nullable = 'NO'
     UNION ALL
     SELECT 'after:unique_token_hash_key' AS object_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'enrollment_bootstrap_attempts'
        AND index_name = 'enrollment_bootstrap_attempts_token_hash_key'
        AND non_unique = 0
      GROUP BY index_name
     HAVING COUNT(*) = 1 AND MAX(column_name) = 'token_hash'
     UNION ALL
     SELECT 'before:token_hash_idx' AS object_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'enrollment_bootstrap_attempts'
        AND index_name = 'enrollment_bootstrap_attempts_token_hash_idx'
        AND column_name = 'token_hash'
      GROUP BY index_name
      HAVING COUNT(*) = 1
     UNION ALL
     SELECT 'after:prepared_status_check' AS object_name
       FROM information_schema.check_constraints cc
       JOIN information_schema.table_constraints tc
         ON tc.constraint_schema = cc.constraint_schema
        AND tc.constraint_name = cc.constraint_name
      WHERE tc.table_schema = DATABASE()
        AND tc.table_name = 'enrollment_bootstrap_attempts'
        AND tc.constraint_type = 'CHECK'
        AND cc.constraint_name = 'enrollment_bootstrap_attempts_status_check'
        AND cc.check_clause LIKE '%PREPARED%'
        AND cc.check_clause LIKE '%COMPLETED%'
        AND cc.check_clause LIKE '%ABANDONED%'
     UNION ALL
     SELECT 'before:completed_status_check' AS object_name
       FROM information_schema.check_constraints cc
       JOIN information_schema.table_constraints tc
         ON tc.constraint_schema = cc.constraint_schema
        AND tc.constraint_name = cc.constraint_name
      WHERE tc.table_schema = DATABASE()
        AND tc.table_name = 'enrollment_bootstrap_attempts'
        AND tc.constraint_type = 'CHECK'
        AND cc.constraint_name = 'enrollment_bootstrap_attempts_status_check'
        AND cc.check_clause LIKE '%COMPLETED%'
        AND cc.check_clause NOT LIKE '%PREPARED%'
        AND cc.check_clause NOT LIKE '%ABANDONED%'
     UNION ALL
     SELECT 'after:device_result_check' AS object_name
       FROM information_schema.check_constraints cc
       JOIN information_schema.table_constraints tc
         ON tc.constraint_schema = cc.constraint_schema
        AND tc.constraint_name = cc.constraint_name
      WHERE tc.table_schema = DATABASE()
        AND tc.table_name = 'enrollment_bootstrap_attempts'
        AND tc.constraint_type = 'CHECK'
        AND cc.constraint_name = 'enrollment_bootstrap_attempts_device_result_check'
        AND cc.check_clause LIKE '%COMPLETED%'
        AND cc.check_clause LIKE '%PREPARED%'
        AND cc.check_clause LIKE '%ABANDONED%'
        AND cc.check_clause LIKE '%device_id%'
        AND cc.check_clause LIKE '%signing_key_id%'
        AND cc.check_clause LIKE '%encryption_key_id%'`,
  );
  const found = new Set(rows.map((row) => row.object_name));

  if (matchesExactly(found, BEFORE_OBJECTS)) return 'ABSENT';
  if (matchesExactly(found, AFTER_OBJECTS)) return 'COMPLETE';
  return 'PARTIAL';
}

function matchesExactly(found, expected) {
  return found.size === expected.length && expected.every((name) => found.has(name));
}
