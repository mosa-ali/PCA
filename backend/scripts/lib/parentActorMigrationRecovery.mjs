const EXPECTED_OBJECTS = new Set([
  'requested_by_parent_account_id',
  'decided_by_parent_account_id',
  'enrollment_protection_approval_requested_by_parent_idx',
  'enrollment_protection_approval_decided_by_parent_idx',
  'enrollment_protection_approval_requested_by_parent_fk',
  'enrollment_protection_approval_decided_by_parent_fk',
]);

/**
 * Migration 0057 is one atomic MySQL ALTER TABLE followed by a separate
 * journal insert. If the process stops between those operations, recognize
 * the complete DDL state and record it instead of replaying duplicate DDL.
 * A partial named-object set is ambiguous and must be repaired explicitly.
 */
export async function inspectParentActorMigrationState(connection) {
  const [rows] = await connection.query(
    `SELECT column_name AS object_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'enrollment_protection_approval_requests'
        AND column_name IN ('requested_by_parent_account_id', 'decided_by_parent_account_id')
     UNION ALL
     SELECT index_name AS object_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'enrollment_protection_approval_requests'
        AND index_name IN ('enrollment_protection_approval_requested_by_parent_idx', 'enrollment_protection_approval_decided_by_parent_idx')
     UNION ALL
     SELECT constraint_name AS object_name
       FROM information_schema.key_column_usage
      WHERE table_schema = DATABASE()
        AND table_name = 'enrollment_protection_approval_requests'
        AND referenced_table_name = 'parent_accounts'
        AND referenced_column_name = 'account_id'
        AND constraint_name IN ('enrollment_protection_approval_requested_by_parent_fk', 'enrollment_protection_approval_decided_by_parent_fk')`,
  );
  const found = new Set(rows.map((row) => row.object_name));
  if (found.size === 0) return 'ABSENT';
  if (found.size === EXPECTED_OBJECTS.size && [...EXPECTED_OBJECTS].every((name) => found.has(name))) return 'COMPLETE';
  return 'PARTIAL';
}
