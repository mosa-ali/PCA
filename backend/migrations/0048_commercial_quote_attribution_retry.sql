-- PCA commercial quote-expiry ATTRIBUTION RETRY state (source-only, pre-production).
--
-- WHAT THIS IS. CommercialMaintenanceRunner attributes a QUOTE_EXPIRED
-- notification through the expired quote's `increase_request_ref`
-- (billing_quotes -> entitlement_change_requests, an opaque no-FK reference per
-- migration 0007). Some expired quotes cannot be attributed at all. Before this
-- migration the runner simply SKIPPED such a row on every pass of every run, and
-- because the backlog scan is ordered `expires_at ASC` and re-issued the same
-- LIMIT query, a batch-full of permanently-unattributable rows sat at the head of
-- the window for ever: eligible rows behind them were starved, the loop only ever
-- exited via MAX_PASSES_PER_RUN, and every run burned 1,000 passes
-- (PCA-COMMERCIAL-LIVENESS-1, measured: 1,000 passes / 3,000 warns / 0 notified).
-- A keyset cursor fixed the WITHIN-RUN progress half. This table fixes the other
-- half: a durable state plus a next-attempt time, so an unattributable row is no
-- longer re-scanned on every maintenance cycle for ever.
--
-- WHY DURABLE AND NOT IN MEMORY. Retry state must survive a restart and be shared
-- by every runner instance, exactly like the action idempotency ledger
-- (migration 0047). A process-local counter would reset on deploy and would give
-- a multi-instance deployment one schedule per process.
--
-- STATE MODEL. Three states exist in the domain
-- (commercialmaintenance/attributionRetry.ts `AttributionState`):
--
--   PENDING_ATTRIBUTION     -- not attributable YET, or not provably never.
--   NOTIFIED                -- DERIVED, never stored here. The durable evidence
--                              is the `commercial_notifications` row keyed
--                              `QUOTE_EXPIRED:<quote_id>`. Storing it a second
--                              time would create a second source of truth for the
--                              same fact and could diverge from the notification
--                              the exactly-once guarantee is built on -- so the
--                              column's CHECK list deliberately omits it.
--   TERMINAL_UNATTRIBUTABLE -- provably never attributable (see below).
--
-- WHY ONLY `REFERENCE_ABSENT` MAY BE TERMINAL, AND WHY THAT IS A PROOF RATHER
-- THAN A GUESS. Two reason codes are distinguished:
--
--   REFERENCE_ABSENT       the quote carries no `increase_request_ref` at all.
--                          `billing_quotes.increase_request_ref` is written by
--                          EXACTLY ONE statement in this codebase -- the INSERT in
--                          backend/src/billing/quote.ts -- and no statement
--                          anywhere in backend/src/** or backend/migrations/**
--                          ever assigns it again; a NULL therefore stays NULL,
--                          attribution can never become derivable from it, and the
--                          state is terminal. test/tooling/
--                          commercialAttributionPermanence.test.mjs fails the
--                          build if any statement starts writing that column, so
--                          the proof is machine-checked rather than assumed.
--   REFERENCE_UNRESOLVED   the quote carries a reference that does not resolve to
--                          an `entitlement_change_requests` row. Those rows are
--                          never deleted (no DELETE statement exists for that
--                          table), so this is anomalous rather than routine -- but
--                          whether a missing row can LATER appear cannot be proven
--                          from source semantics, so it is deliberately NOT
--                          terminal. It stays PENDING_ATTRIBUTION under backoff.
--                          Recording permanence it does not have would silently
--                          drop a notification that may still be owed, and
--                          terminalising on age or on retry count alone is
--                          explicitly not authorized.
--
-- RETRY/BACKOFF. A PENDING row is excluded from the backlog scan until
-- `next_attempt_at` (bounded exponential backoff, computed by
-- backend/src/commercialmaintenance/attributionRetry.ts), so an unattributable
-- backlog costs a bounded and decaying amount of work per run instead of a full
-- re-scan of the same rows for ever. A row that later becomes attributable is
-- published normally and its state row is deleted, which is what preserves future
-- recovery.
--
-- Production execution is a later owner-authorized gate; production is still
-- behind this migration.
CREATE TABLE IF NOT EXISTS commercial_quote_attribution_retry (
  quote_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- Closed vocabulary of the two NON-derived states; see the state model above
  -- for why NOTIFIED is deliberately absent.
  state VARCHAR(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  reason_code VARCHAR(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(3) NOT NULL,
  terminal_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (quote_id),
  -- The backlog scan's own access path: due PENDING rows, and nothing else.
  KEY commercial_quote_attribution_retry_due_idx (state, next_attempt_at),
  CONSTRAINT commercial_quote_attribution_retry_quote_id_fk
    FOREIGN KEY (quote_id) REFERENCES billing_quotes (quote_id) ON DELETE CASCADE,
  CONSTRAINT commercial_quote_attribution_retry_state_check
    CHECK (state IN ('PENDING_ATTRIBUTION', 'TERMINAL_UNATTRIBUTABLE')),
  CONSTRAINT commercial_quote_attribution_retry_reason_check
    CHECK (reason_code IN ('REFERENCE_ABSENT', 'REFERENCE_UNRESOLVED')),
  -- Terminal exactly when terminal_at exists, asserted in both directions so
  -- neither can be satisfied vacuously: a TERMINAL row must carry a time, and a
  -- PENDING row must not.
  CONSTRAINT commercial_quote_attribution_retry_terminal_check
    CHECK ((state <> 'TERMINAL_UNATTRIBUTABLE') OR (terminal_at IS NOT NULL)),
  CONSTRAINT commercial_quote_attribution_retry_pending_check
    CHECK ((state <> 'PENDING_ATTRIBUTION') OR (terminal_at IS NULL))
) ENGINE=InnoDB;
