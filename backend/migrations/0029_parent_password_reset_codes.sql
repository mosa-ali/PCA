-- PCA product-completion programme (P1 /login finding): account-level
-- (service-session) password reset for a VERIFIED parent account.
-- Deliberately a SEPARATE table from parent_email_verification_codes
-- (migration 0013), not a reused/repurposed one -- these two code kinds
-- protect different actions (proving control of an unverified mailbox at
-- registration vs. proving control of an already-verified account's
-- mailbox to replace its credential) and mixing them into one table would
-- make it possible for a stale verification-code row to be replayed
-- against the reset endpoint or vice versa. Same shape, same single-use/
-- TTL-bounded/attempt-counted discipline as migration 0013's own table --
-- see that migration's header for the full rationale, which applies here
-- unchanged.
--
-- Distinct from the family-E2EE Recovery flow (crypto-gated, PCA-13): this
-- is account-level (service-session) credential replacement, not family
-- data recovery, and does not touch or require PRODUCTION_CRYPTO_SUITE.
CREATE TABLE parent_password_reset_codes (
  code_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (code_id),
  KEY parent_password_reset_codes_account_idx (account_id, created_at),
  CONSTRAINT parent_password_reset_codes_account_fk FOREIGN KEY (account_id) REFERENCES parent_accounts (account_id)
) ENGINE=InnoDB;
