-- database/live-bootstrap/00_preflight.sql
--
-- Run this FIRST, against the target live database, before
-- 01_create_database_schema.sql. Every check below fails CLOSED: a failed
-- assertion raises a real SQL error (SIGNAL), which stops a non-interactive
-- `mysql < 00_preflight.sql` or `SOURCE 00_preflight.sql` run at that
-- statement -- it will not silently continue into schema creation. If ANY
-- check fails, STOP. Do not proceed to 01_create_database_schema.sql. Do not
-- "fix" a failure by dropping tables in the target database without first
-- understanding what they are -- see OWNER_RUNBOOK.md.
--
-- This file never modifies the target database's schema. It only reads
-- information_schema and session/global variables, plus a temporary
-- assertion procedure it creates and drops within this same run.

SELECT DATABASE() AS target_database, CURRENT_USER() AS connected_as, NOW() AS preflight_started_at;

-- Every message below is kept under MySQL's hard 128-character limit for a
-- SIGNAL's MESSAGE_TEXT (a longer literal fails with ER_COND_ITEM_TOO_LONG
-- BEFORE the intended message is ever raised, defeating the point) -- the
-- full rationale for each check lives in the comment above it instead.
DELIMITER $$
DROP PROCEDURE IF EXISTS _pca_preflight_assert $$
CREATE PROCEDURE _pca_preflight_assert(IN condition_met BOOLEAN, IN message VARCHAR(128))
BEGIN
  IF NOT condition_met THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = message;
  END IF;
END $$
DELIMITER ;

-- Check 1: a database MUST be selected explicitly (never rely on a session
-- default that could silently point somewhere else).
CALL _pca_preflight_assert(
  DATABASE() IS NOT NULL,
  'PREFLIGHT FAILED: no database selected. Run USE <target_database>; first.'
);

-- Check 2: the target database must not already contain ANY PCA central
-- table -- in particular schema_migrations, whose existence means either
-- (a) this database already went through migrate.mjs, or (b) a previous
-- bootstrap attempt partially ran. Never "merge" into an unknown existing
-- schema automatically (mission requirement) -- if this fails, STOP and
-- investigate manually; do not re-run this preflight with the check
-- removed.
CALL _pca_preflight_assert(
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema = DATABASE() AND table_name = 'schema_migrations') = 0,
  'PREFLIGHT FAILED: schema_migrations already exists. Database may already hold PCA tables. STOP.'
);

-- Check 3: the target database must currently be completely empty of base
-- tables (a stronger, independent restatement of Check 2 -- catches a
-- database that has SOME unrelated tables but not yet schema_migrations,
-- which would otherwise slip through Check 2 only to collide partway
-- through 01_create_database_schema.sql).
CALL _pca_preflight_assert(
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE') = 0,
  'PREFLIGHT FAILED: target database is not empty. This bootstrap requires an empty database. STOP.'
);

-- Check 4: MySQL version must be 8.0.16+ (CHECK constraints genuinely
-- enforced, not merely parsed) -- this schema was built and equivalence-
-- tested against MySQL 8.4 specifically; anything older than 8.0.16 is
-- rejected outright, and anything other than 8.4.x is flagged as
-- unverified (see PCA_LIVE_DATABASE_SETTINGS.md section 1).
CALL _pca_preflight_assert(
  CAST(SUBSTRING_INDEX(VERSION(), '.', 1) AS UNSIGNED) >= 8,
  CONCAT('PREFLIGHT FAILED: MySQL major version must be 8.x. Found: ', VERSION())
);
CALL _pca_preflight_assert(
  NOT (
    CAST(SUBSTRING_INDEX(VERSION(), '.', 1) AS UNSIGNED) = 8
    AND CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(VERSION(), '.', 2), '.', -1) AS UNSIGNED) = 0
    AND CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(VERSION(), '.', 3), '.', -1) AS UNSIGNED) < 16
  ),
  CONCAT('PREFLIGHT FAILED: MySQL <8.0.16 lacks enforced CHECK constraints. Found: ', VERSION())
);
SELECT VERSION() AS mysql_version, IF(VERSION() LIKE '8.4%', 'MATCHES TESTED VERSION', 'DIFFERENT FROM 8.4 -- UNVERIFIED, review PCA_LIVE_DATABASE_SETTINGS.md before proceeding') AS version_note;

-- Check 5: utf8mb4 must be available (it always is on 8.x, but fail closed
-- rather than assume).
CALL _pca_preflight_assert(
  (SELECT COUNT(*) FROM information_schema.character_sets WHERE character_set_name = 'utf8mb4') = 1,
  'PREFLIGHT FAILED: utf8mb4 character set is not available on this server.'
);

-- Check 6: the connected user must hold CREATE on this database (also
-- required: REFERENCES, for 01_create_database_schema.sql's foreign keys --
-- not independently checkable here as precisely as CREATE, so confirmed
-- instead by 01 itself failing loudly if absent).
CALL _pca_preflight_assert(
  (
    SELECT COUNT(*) FROM information_schema.schema_privileges
    WHERE table_schema = DATABASE() AND privilege_type = 'CREATE'
  ) > 0
  OR (
    SELECT COUNT(*) FROM information_schema.user_privileges
    WHERE privilege_type = 'CREATE'
  ) > 0,
  'PREFLIGHT FAILED: connected user lacks CREATE. Use the migration/provisioning credential.'
);

-- Informational (not a hard failure): record case-sensitivity mode and
-- sql_mode for the owner's own records -- see PCA_LIVE_DATABASE_SETTINGS.md
-- sections 5 and 7. This schema's identifiers are all lowercase and does
-- not depend on either mode, but a later environment mismatch should be
-- detectable, not silent.
SELECT @@GLOBAL.lower_case_table_names AS lower_case_table_names, @@SESSION.sql_mode AS session_sql_mode, @@GLOBAL.sql_mode AS global_sql_mode;
CALL _pca_preflight_assert(
  @@SESSION.sql_mode LIKE '%STRICT_TRANS_TABLES%' OR @@GLOBAL.sql_mode LIKE '%STRICT_TRANS_TABLES%',
  'PREFLIGHT FAILED: STRICT_TRANS_TABLES is not in effect. See PCA_LIVE_DATABASE_SETTINGS.md section 5.'
);

DROP PROCEDURE _pca_preflight_assert;

SELECT 'PCA-LIVE-DB-0 PREFLIGHT: ALL CHECKS PASSED -- safe to proceed to 01_create_database_schema.sql' AS result;
