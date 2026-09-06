-- PCA-DW-W2-15F -- durable email outbox/queue backing EmailService's
-- bounded-retry + dead-letter delivery of verification/password-reset
-- codes.
--
-- ENCRYPTION AT REST, NOT A RAW EMAIL/CODE COLUMN: migrations/
-- 0013_parent_account_identity.sql established, and has never broken, the
-- invariant that "no raw email column exists" anywhere in this domain
-- (email_hash is the only queryable form). A durable outbox genuinely
-- needs the recipient address and code at rest to survive a process
-- restart between enqueue and send, which this table satisfies WITHOUT a
-- raw-email column: `encrypted_payload` (plus its iv/auth-tag) is an
-- AES-256-GCM ciphertext of a small JSON blob (recipient + kind + code),
-- keyed by PCA_EMAIL_OUTBOX_ENCRYPTION_KEY (never stored here, never in
-- git -- see backend/src/email/emailOutboxEncryption.ts). This still
-- differs from migration 0013's stronger guarantee (the live process
-- itself cannot decrypt those columns at all) -- it cannot, here, since the
-- process must decrypt to actually send the email -- which is exactly why
-- EmailOutboxProcessor purges/redacts a row's ciphertext columns once it
-- reaches a terminal state (SENT or DEAD_LETTER), bounding how long that
-- necessary exposure window exists.
--
-- No FOREIGN KEY to parent_accounts: an outbox row identifies its
-- recipient only inside the encrypted payload, never in a plaintext or
-- joinable column, so there is nothing here to reference a parent account
-- BY.
CREATE TABLE email_outbox (
  outbox_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- Caller-supplied, deterministic per logical send attempt -- protects
  -- against a duplicate enqueue (e.g. a client-retried HTTP request)
  -- producing two outbox rows, and thus two delivered emails, for what the
  -- caller intended as one send.
  idempotency_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  encrypted_iv VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  encrypted_auth_tag VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- NULL once purged (see header) -- a terminal row keeps its metadata
  -- (status/attempt_count/timestamps) for observability without keeping
  -- the sensitive payload around any longer than necessary.
  encrypted_payload TEXT CHARACTER SET ascii COLLATE ascii_bin NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  attempt_count INT NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(3) NOT NULL,
  last_error VARCHAR(512) NULL,
  provider_message_id VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  -- Past this instant a row is treated as dead regardless of attempt_count
  -- -- the code it carries has its own short TTL (VERIFICATION_CODE_TTL_MS/
  -- PASSWORD_RESET_CODE_TTL_MS, both far shorter than this), so resending
  -- it after the code has expired would just deliver a useless message.
  expires_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (outbox_id),
  UNIQUE KEY email_outbox_idempotency_key_key (idempotency_key),
  KEY email_outbox_status_next_attempt_idx (status, next_attempt_at),
  CONSTRAINT email_outbox_status_check CHECK (status IN ('PENDING', 'SENT', 'DEAD_LETTER'))
) ENGINE=InnoDB;
