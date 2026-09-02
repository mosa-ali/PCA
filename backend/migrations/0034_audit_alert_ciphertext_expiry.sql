-- PCA server-ciphertext retention: gives `family_audit_events` (migration
-- 0028) and `protection_alerts` (migration 0025) the SAME `expires_at`
-- column `relay_envelopes` has carried since migration 0001.
--
-- WHY: all three tables are the same class of store -- append-only,
-- server-unreadable ciphertext held only so a specific trusted parent
-- device can collect and decrypt it locally. relay_envelopes enforces a
-- 7-day ceiling on that (MAX_RELAY_TTL_MS, backend/src/relay/policy.ts),
-- with reads that exclude expired rows and a purgeExpired DELETE, precisely
-- because "relay TTL is operational delivery availability, never family
-- activity retention" (that file's own header). 0025 and 0028 each state
-- they mirror the preceding table's contract exactly, but neither carried
-- the expiry half of it: both grew without bound, so the central service
-- accumulated family ciphertext forever. This migration applies the
-- existing precedent to them; it introduces no new retention policy, no new
-- readable field, and no new plaintext surface.
--
-- ADDITIVE ONLY: two new columns and two new indexes. No existing column,
-- constraint, or row's meaning changes, and nothing here reads, decrypts,
-- or reshapes `encrypted_payload_b64`.
--
-- THE SENTINEL DEFAULT: relay_envelopes declares `expires_at DATETIME(3)
-- NOT NULL` with no default, which is also what the application always
-- supplies here (MySqlProtectionAlertLedger / MySqlFamilyAuditEventLedger
-- compute it from generated_at_utc via computeServerCiphertextExpiry).
-- MySQL cannot add a NOT NULL column to a table that already has rows
-- without one, so the column is declared with an epoch sentinel and every
-- pre-existing row is immediately backfilled to its real relay-equivalent
-- expiry by the UPDATE below. The sentinel is deliberately in the PAST:
-- a row that somehow reached this table without an explicit expiry is
-- treated as already expired and purged, never as retained forever.
-- Failing toward deletion is the safe direction for server-held family
-- ciphertext -- retention here is a liability, not an asset.
--
-- INDEX: a plain index on expires_at, which is what the purge
-- (`DELETE ... WHERE expires_at <= ?`, mirroring
-- MySqlRelayRepository.purgeExpired) needs. The existing
-- (family_id, parent_device_id, generated_at_utc) indexes continue to serve
-- the per-device feed reads and their ORDER BY; the added expiry predicate
-- is a residual filter on that same access path.

ALTER TABLE family_audit_events
  ADD COLUMN expires_at DATETIME(3) NOT NULL DEFAULT '1970-01-01 00:00:00.000',
  ADD KEY family_audit_events_expires_at_idx (expires_at);

UPDATE family_audit_events
  SET expires_at = DATE_ADD(generated_at_utc, INTERVAL 7 DAY)
  WHERE expires_at = '1970-01-01 00:00:00.000';

ALTER TABLE protection_alerts
  ADD COLUMN expires_at DATETIME(3) NOT NULL DEFAULT '1970-01-01 00:00:00.000',
  ADD KEY protection_alerts_expires_at_idx (expires_at);

UPDATE protection_alerts
  SET expires_at = DATE_ADD(generated_at_utc, INTERVAL 7 DAY)
  WHERE expires_at = '1970-01-01 00:00:00.000';
