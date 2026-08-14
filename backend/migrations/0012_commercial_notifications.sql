-- PCA-COMMERCIAL-NOTIFY-1: durable commercial notification event/read model.
-- Introduces exactly one new table, `commercial_notifications`. No existing
-- table (0001-0011) is altered.
--
-- LANE BOUNDARY: this lane owns durable commercial events/read state, NOT
-- transport delivery to email/SMS/push, and NOT the emitting domains
-- (Quote/Payment/Entitlement/Request) themselves -- see
-- backend/src/commercialnotifications/CommercialNotificationPublisher.ts's
-- header for the narrow publish interface those domains call, and this
-- lane's final report for the SHARED_INTEGRATION_REQUIRED call-site list.
-- Follows migration 0007/0008's own conventions: explicit CHAR(36)
-- ASCII/binary ids, an opaque `account_ref` scoping column (mirroring
-- billing_subscriptions/billing_payment_methods/billing_invoices/
-- billing_payment_attempts/billing_payment_transactions in migration 0007
-- -- deliberately NOT a `family_id` FOREIGN KEY into the family/parent
-- plane, the same commercial/family-plane isolation billing_core's own
-- schemaPrivacy test enforces), CHECK-constrained closed-vocabulary
-- columns, no family-activity/policy/payment-instrument-secret column.
--
-- DEDUPE IDENTITY (constraint 5, "durable idempotency"): `dedupe_key`
-- (UNIQUE) is the SOLE concurrency/idempotency primitive, following the
-- EXACT SAME discipline as billing_provider_events's
-- UNIQUE(provider, provider_event_id) (migration 0007) and
-- billing_refund_operations's UNIQUE(idempotency_key) (migration 0008):
-- INSERT relying entirely on this constraint, never a pre-check-then-insert
-- (TOCTOU) pattern -- see CommercialNotificationRepository.recordIfNew. A
-- caller constructs `dedupe_key` deterministically from the logical source
-- event (e.g. `PAYMENT_CONFIRMED:<provider_event_row_id>`,
-- `ENTITLEMENT_INCREASED:<change_request_id>`,
-- `QUOTE_EXPIRED:<quote_id>`), so one logical commercial event can never
-- produce two notification rows even under concurrent/duplicate delivery.
--
-- LOCALIZATION MODEL (constraint 4): `message_key` + `params_json` (a safe,
-- server-controlled structured parameter bag -- never free-text, never a
-- pre-rendered English sentence) rather than a server-generated
-- English-only message, so Parent Web can localize EN/AR.
--
-- PRIVACY (constraint 3, "data minimization"): no PAN/CVV/provider
-- secret/raw webhook body/child URL/location/app-usage/family-policy/
-- family-key column exists on this table -- see
-- backend/test/commercialnotifications/schemaPrivacy.test.mjs and its live
-- counterpart backend/test/db/commercialNotificationsSchemaPrivacy.mysql.test.mjs.
CREATE TABLE commercial_notifications (
  notification_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_ref VARCHAR(128) NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  dedupe_key VARCHAR(191) NOT NULL,
  resource_ref VARCHAR(128) NULL,
  message_key VARCHAR(64) NOT NULL,
  params_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  read_at DATETIME(3) NULL,
  acknowledged_at DATETIME(3) NULL,
  PRIMARY KEY (notification_id),
  UNIQUE KEY commercial_notifications_dedupe_key (dedupe_key),
  KEY commercial_notifications_account_created_idx (account_ref, created_at),
  KEY commercial_notifications_account_unread_idx (account_ref, read_at),
  CONSTRAINT commercial_notifications_account_ref_check CHECK (CHAR_LENGTH(account_ref) BETWEEN 1 AND 128),
  CONSTRAINT commercial_notifications_dedupe_key_check CHECK (CHAR_LENGTH(dedupe_key) BETWEEN 1 AND 191),
  CONSTRAINT commercial_notifications_message_key_check CHECK (CHAR_LENGTH(message_key) BETWEEN 1 AND 64),
  CONSTRAINT commercial_notifications_resource_ref_check CHECK (resource_ref IS NULL OR CHAR_LENGTH(resource_ref) BETWEEN 1 AND 128),
  CONSTRAINT commercial_notifications_event_type_check CHECK (
    event_type IN ('QUOTE_READY', 'PAYMENT_CONFIRMED', 'ENTITLEMENT_INCREASED', 'PAYMENT_FAILED', 'REQUEST_DENIED', 'QUOTE_EXPIRED')
  ),
  CONSTRAINT commercial_notifications_acknowledged_after_read_check CHECK (acknowledged_at IS NULL OR read_at IS NOT NULL)
) ENGINE=InnoDB;
