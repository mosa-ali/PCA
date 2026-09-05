-- database/live-bootstrap/04_schema_fingerprint.sql
--
-- Computes a SQL-native, portable schema fingerprint using only a MySQL
-- client (no Node required) -- useful for an ops team re-checking a live
-- database's structure later with nothing but `mysql` on hand. Save the
-- output of this file immediately after a successful bootstrap; re-run it
-- any time later and compare.
--
-- THIS IS A SECONDARY / CONVENIENCE FINGERPRINT, not the authoritative one.
-- Its hash input format is necessarily different from the AUTHORITATIVE
-- CANONICAL_SCHEMA_FINGERPRINT recorded in
-- docs/database/PCA_CANONICAL_SCHEMA_REPORT.md (computed by
-- backend/scripts/schema-fingerprint.mjs against a full structural
-- introspection, including foreign keys and CHECK constraints, which are
-- awkward to fold into one portable SQL string deterministically) -- the
-- two values will never be bit-for-bit equal, and that is expected. Prefer
-- `PCA_DATABASE_URL=... node backend/scripts/post-validate.mjs` (which
-- checks the AUTHORITATIVE fingerprint) whenever Node is available; use
-- this file only as a Node-independent fallback drift signal.
SET SESSION group_concat_max_len = 1048576;

SELECT
  SHA2(
    GROUP_CONCAT(
      CONCAT_WS('|', table_name, column_name, ordinal_position, column_type, is_nullable, IFNULL(column_default, ''), extra, IFNULL(character_set_name, ''), IFNULL(collation_name, ''))
      ORDER BY table_name, ordinal_position
      SEPARATOR ';'
    ),
    256
  ) AS columns_fingerprint
FROM information_schema.columns
WHERE table_schema = DATABASE();

SELECT
  SHA2(
    GROUP_CONCAT(
      CONCAT_WS('|', table_name, index_name, non_unique, seq_in_index, column_name)
      ORDER BY table_name, index_name, seq_in_index
      SEPARATOR ';'
    ),
    256
  ) AS indexes_fingerprint
FROM information_schema.statistics
WHERE table_schema = DATABASE();

SELECT
  SHA2(
    GROUP_CONCAT(
      CONCAT_WS('|', table_name, column_name, referenced_table_name, referenced_column_name)
      ORDER BY constraint_name, ordinal_position
      SEPARATOR ';'
    ),
    256
  ) AS foreign_keys_fingerprint
FROM information_schema.key_column_usage
WHERE table_schema = DATABASE() AND referenced_table_name IS NOT NULL;

SELECT
  SHA2(CONCAT_WS('/', @columns_fp := (
    SELECT SHA2(GROUP_CONCAT(CONCAT_WS('|', table_name, column_name, ordinal_position, column_type, is_nullable, IFNULL(column_default, ''), extra, IFNULL(character_set_name, ''), IFNULL(collation_name, '')) ORDER BY table_name, ordinal_position SEPARATOR ';'), 256)
    FROM information_schema.columns WHERE table_schema = DATABASE()
  ), @indexes_fp := (
    SELECT SHA2(GROUP_CONCAT(CONCAT_WS('|', table_name, index_name, non_unique, seq_in_index, column_name) ORDER BY table_name, index_name, seq_in_index SEPARATOR ';'), 256)
    FROM information_schema.statistics WHERE table_schema = DATABASE()
  ), @fks_fp := (
    SELECT SHA2(GROUP_CONCAT(CONCAT_WS('|', table_name, column_name, referenced_table_name, referenced_column_name) ORDER BY constraint_name, ordinal_position SEPARATOR ';'), 256)
    FROM information_schema.key_column_usage WHERE table_schema = DATABASE() AND referenced_table_name IS NOT NULL
  )), 256) AS PCA_SQL_NATIVE_SCHEMA_FINGERPRINT;

SELECT 'Record the PCA_SQL_NATIVE_SCHEMA_FINGERPRINT value above alongside this bootstrap run for future drift comparison.' AS note;
