-- PCA-AUTH-SESSION-1 security fix (PENDING_VERIFICATION credential
-- takeover): bind the credential a verification code AUTHORISES to the
-- code row itself, instead of to the shared, mutable
-- parent_accounts.password_hash column.
--
-- THE DEFECT THIS CLOSES: ParentAccountService.register() previously
-- called ParentAccountRepository.updatePendingPasswordHash() whenever a
-- registration arrived for an email that already had a still-unverified
-- account, i.e. ANY unauthenticated caller could overwrite a pending
-- account's stored credential with their own while the fresh verification
-- code was still delivered to the real mailbox owner. The owner's own
-- verification then activated the account carrying the OTHER party's
-- password. Neither "last registration wins" (the old behaviour) nor
-- "first registration wins" is a fix: whichever rule is chosen, the party
-- it favours can simply register in that position. The credential has to
-- travel with the one-time secret that authorises it, which is what this
-- column makes possible.
--
-- ADDITIVE AND BACKWARD-COMPATIBLE: NULLable with no default and no
-- backfill. A row written before this migration (or by an older binary
-- mid-deploy) simply carries NULL, and
-- MySqlParentAccountRepository.markVerified's
-- `password_hash = COALESCE(?, password_hash)` leaves the account's
-- existing credential exactly as it was for such a row -- byte-for-byte
-- the pre-migration behaviour, never a fabricated or emptied credential.
--
-- NO PLAINTEXT PERSONAL DATA: the column stores exactly the same
-- scrypt-derived credential digest shape that parent_accounts.password_hash
-- already stores (see backend/src/parentaccount/passwordCredential.ts --
-- `scrypt$N$r$p$salt$derivedKey`, never a raw password), under the same
-- VARCHAR(255) type as that column, and is never read back out to any
-- caller: verifyEmail moves it onto the account row and nothing else ever
-- selects it. No raw email, password, or other personal datum is added to
-- this table by this migration -- see migration 0013's own header for this
-- table's unchanged privacy posture.
--
-- IDEMPOTENCY (2026-09-21, PCA full assessment finding P1-07 / QA-11):
-- scripts/migrate.mjs records this file as applied only after the WHOLE file
-- succeeds, so a process that dies after MySQL auto-commits this statement but
-- before the schema_migrations row is written would otherwise make a retry fail
-- with ER_DUP_FIELDNAME ("Duplicate column name"). MySQL has no
-- `ADD COLUMN IF NOT EXISTS` (that is a MariaDB-only extension -- MySQL 8.4
-- raises ER_PARSE_ERROR on it), so this uses the same conditional
-- PREPARE/EXECUTE idiom migration 0042 already established. A fresh run applies
-- the column exactly as before; a resumed run skips it; the intended final
-- schema is identical either way.
SET @pca_0030_column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'parent_email_verification_codes'
     AND column_name = 'password_hash'
);
SET @pca_0030_alter_sql = IF(
  @pca_0030_column_exists = 0,
  'ALTER TABLE parent_email_verification_codes ADD COLUMN password_hash VARCHAR(255) NULL AFTER code_hash',
  'SELECT 1'
);
PREPARE pca_0030_stmt FROM @pca_0030_alter_sql;
EXECUTE pca_0030_stmt;
DEALLOCATE PREPARE pca_0030_stmt;
