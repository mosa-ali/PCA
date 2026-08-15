-- PCA-ADD-BILL-020 (Writer65): cross-batch USD-normalized settlement
-- reporting rollup. `settlement_batches` (migration 0015) has exactly one
-- `settlement_currency` per batch and never a stored conversion into any
-- other currency -- there is no live-fetched-rate path anywhere in this
-- lane (SettlementService.recordFxSnapshot's own doc comment), so a
-- cross-currency USD rollup needs its own administrator-recorded,
-- immutable rate per non-USD batch, exactly mirroring
-- `settlement_fx_snapshots`' existing immutability discipline (migration
-- 0015 file header) rather than inventing a live conversion.
--
-- ADDITIVE ONLY: three new nullable columns on `settlement_batches`. A
-- batch already denominated in USD needs no rate (the rollup treats it as
-- rate=1 implicitly, never writes a row here for it). A non-USD batch has
-- NO recorded rate until an admin explicitly records one via
-- `POST /platform-admin/settlement/batches/:id/usd-normalization` -- until
-- then it is correctly EXCLUDED from the USD rollup (never coerced to a
-- fabricated 1:1 rate), mirroring this codebase's "capability: UNAVAILABLE
-- rather than a fabricated zero" convention (DashboardReadModel.ts).
-- Write-once/immutable: no UPDATE statement against these three columns
-- exists anywhere in this lane's repository once set (see
-- MySqlSettlementRepository.recordUsdNormalization's own doc comment).
ALTER TABLE settlement_batches
  ADD COLUMN usd_normalized_rate DECIMAL(24, 10) NULL,
  ADD COLUMN usd_normalized_recorded_at DATETIME(3) NULL,
  ADD COLUMN usd_normalized_by_admin_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD CONSTRAINT settlement_batches_usd_norm_rate_check CHECK (usd_normalized_rate IS NULL OR usd_normalized_rate > 0),
  ADD CONSTRAINT settlement_batches_usd_norm_by_fk FOREIGN KEY (usd_normalized_by_admin_id) REFERENCES platform_admin_accounts (admin_id),
  ADD CONSTRAINT settlement_batches_usd_norm_pair_check CHECK (
    (usd_normalized_rate IS NULL AND usd_normalized_recorded_at IS NULL AND usd_normalized_by_admin_id IS NULL)
    OR (usd_normalized_rate IS NOT NULL AND usd_normalized_recorded_at IS NOT NULL AND usd_normalized_by_admin_id IS NOT NULL)
  );
