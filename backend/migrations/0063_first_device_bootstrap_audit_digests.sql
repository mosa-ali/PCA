-- 0063_first_device_bootstrap_audit_digests.sql
-- Wave 6B-R1 (finding R1-03): durable auditability for the first-device trust-root bootstrap.
--
-- After a successful ceremony, an independent reviewer must be able to
-- reconstruct and re-verify the exact canonical PCA_FIRST_DEVICE_BOOTSTRAP_V1
-- proof statement from durable non-secret state alone (ceremony row + anchor +
-- accepted epoch-1 bytes). The only proof field not reconstructible today is
-- the attestation evidence digest, and there is no byte-level binding of the
-- exact submitted proof bytes. This migration adds two digest columns to the
-- existing ceremony table:
--   bootstrap_proof_sha256      -- sha256 of the exact canonical proof bytes
--   attestation_evidence_sha256 -- sha256 of the exact attestation evidence
--                                  string; NULL means the proof bound the
--                                  literal 'null' marker
-- Digests only: raw proof bytes and raw attestation evidence are NEVER stored.
-- Additive, staged (probe-then-alter), replay-safe. LIVE APPLICATION IS NOT
-- AUTHORIZED. Pre-0063 COMMITTED rows keep NULL digests (grandfathered).
--
-- Constraint names are abbreviated (<= 64 chars: MySQL identifier limit) and
-- must stay byte-identical between this file, its probes, schema.ts and the
-- migration-safety tests.

SET @pca_0063_previous_character_set_connection = @@character_set_connection;
SET character_set_connection = utf8mb4;

-- 1) bootstrap_proof_sha256 (appended at the end: schema fingerprint preserves column order).
SET @pca_0063_proof_sha_exists = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'family_first_device_bootstrap_ceremonies'
     AND column_name = 'bootstrap_proof_sha256'
);
SET @pca_0063_proof_sha_sql = IF(
  @pca_0063_proof_sha_exists = 0,
  'ALTER TABLE family_first_device_bootstrap_ceremonies ADD COLUMN bootstrap_proof_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL',
  'SELECT 1'
);
PREPARE pca_0063_proof_sha_stmt FROM @pca_0063_proof_sha_sql;
EXECUTE pca_0063_proof_sha_stmt;
DEALLOCATE PREPARE pca_0063_proof_sha_stmt;

-- 2) attestation_evidence_sha256.
SET @pca_0063_evidence_sha_exists = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'family_first_device_bootstrap_ceremonies'
     AND column_name = 'attestation_evidence_sha256'
);
SET @pca_0063_evidence_sha_sql = IF(
  @pca_0063_evidence_sha_exists = 0,
  'ALTER TABLE family_first_device_bootstrap_ceremonies ADD COLUMN attestation_evidence_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL',
  'SELECT 1'
);
PREPARE pca_0063_evidence_sha_stmt FROM @pca_0063_evidence_sha_sql;
EXECUTE pca_0063_evidence_sha_stmt;
DEALLOCATE PREPARE pca_0063_evidence_sha_stmt;

-- 3) ffdbc_proof_sha256_hex_check: lowercase hex sha256 or NULL.
SET @pca_0063_check1_exists = (
  SELECT COUNT(*) FROM information_schema.table_constraints
   WHERE constraint_schema = DATABASE() AND table_name = 'family_first_device_bootstrap_ceremonies'
     AND constraint_name = 'ffdbc_proof_sha256_hex_check'
);
SET @pca_0063_check1_sql = IF(
  @pca_0063_check1_exists = 0,
  'ALTER TABLE family_first_device_bootstrap_ceremonies ADD CONSTRAINT ffdbc_proof_sha256_hex_check CHECK (bootstrap_proof_sha256 IS NULL OR bootstrap_proof_sha256 REGEXP ''^[0-9a-f]{64}$'')',
  'SELECT 1'
);
PREPARE pca_0063_check1_stmt FROM @pca_0063_check1_sql;
EXECUTE pca_0063_check1_stmt;
DEALLOCATE PREPARE pca_0063_check1_stmt;

-- 4) ffdbc_evidence_sha256_hex_check: lowercase hex sha256 or NULL.
SET @pca_0063_check2_exists = (
  SELECT COUNT(*) FROM information_schema.table_constraints
   WHERE constraint_schema = DATABASE() AND table_name = 'family_first_device_bootstrap_ceremonies'
     AND constraint_name = 'ffdbc_evidence_sha256_hex_check'
);
SET @pca_0063_check2_sql = IF(
  @pca_0063_check2_exists = 0,
  'ALTER TABLE family_first_device_bootstrap_ceremonies ADD CONSTRAINT ffdbc_evidence_sha256_hex_check CHECK (attestation_evidence_sha256 IS NULL OR attestation_evidence_sha256 REGEXP ''^[0-9a-f]{64}$'')',
  'SELECT 1'
);
PREPARE pca_0063_check2_stmt FROM @pca_0063_check2_sql;
EXECUTE pca_0063_check2_stmt;
DEALLOCATE PREPARE pca_0063_check2_stmt;

-- 5) ffdbc_proof_sha256_committed_check: the proof digest exists only on committed rows.
SET @pca_0063_check3_exists = (
  SELECT COUNT(*) FROM information_schema.table_constraints
   WHERE constraint_schema = DATABASE() AND table_name = 'family_first_device_bootstrap_ceremonies'
     AND constraint_name = 'ffdbc_proof_sha256_committed_check'
);
SET @pca_0063_check3_sql = IF(
  @pca_0063_check3_exists = 0,
  'ALTER TABLE family_first_device_bootstrap_ceremonies ADD CONSTRAINT ffdbc_proof_sha256_committed_check CHECK (bootstrap_proof_sha256 IS NULL OR (status = ''COMMITTED'' AND consumed_at IS NOT NULL))',
  'SELECT 1'
);
PREPARE pca_0063_check3_stmt FROM @pca_0063_check3_sql;
EXECUTE pca_0063_check3_stmt;
DEALLOCATE PREPARE pca_0063_check3_stmt;

-- 6) ffdbc_evidence_requires_proof_check: an evidence digest never exists without the proof digest.
SET @pca_0063_check4_exists = (
  SELECT COUNT(*) FROM information_schema.table_constraints
   WHERE constraint_schema = DATABASE() AND table_name = 'family_first_device_bootstrap_ceremonies'
     AND constraint_name = 'ffdbc_evidence_requires_proof_check'
);
SET @pca_0063_check4_sql = IF(
  @pca_0063_check4_exists = 0,
  'ALTER TABLE family_first_device_bootstrap_ceremonies ADD CONSTRAINT ffdbc_evidence_requires_proof_check CHECK (attestation_evidence_sha256 IS NULL OR bootstrap_proof_sha256 IS NOT NULL)',
  'SELECT 1'
);
PREPARE pca_0063_check4_stmt FROM @pca_0063_check4_sql;
EXECUTE pca_0063_check4_stmt;
DEALLOCATE PREPARE pca_0063_check4_stmt;

SET character_set_connection = @pca_0063_previous_character_set_connection;
