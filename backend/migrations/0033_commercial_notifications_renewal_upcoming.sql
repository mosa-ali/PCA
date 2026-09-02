-- PCA-COMMERCIAL-RUNTIME-1 follow-up: widens commercial_notifications'
-- closed event_type vocabulary (migration 0012) to add `RENEWAL_UPCOMING`,
-- so CommercialMaintenanceRunner's new upcoming-subscription-renewal sweep
-- (backend/src/commercialmaintenance/CommercialMaintenanceRunner.ts) can
-- publish a purely internal, provider-neutral "your subscription renews
-- soon" reminder via the SAME CommercialNotificationPublisher every other
-- commercial event in this module already uses.
--
-- DISTINCT FROM `auto_renew` (migration 0031): that migration added only a
-- flag/state column recording a parent's stated renewal preference, with no
-- job that actually re-charges anyone. This migration is equally inert on
-- its own -- it only widens a CHECK constraint's allowed value set for a
-- notification row's event_type column -- and introduces no new table, no
-- payment-provider integration, and no real charging semantics.
--
-- ADDITIVE ONLY: widens the existing CHECK constraint (same name, same
-- column, same DROP CHECK + ADD CONSTRAINT pattern as migration 0026's
-- devices_platform_check widening) to also allow 'RENEWAL_UPCOMING'; every
-- previously-valid value remains valid, no existing row is affected, and no
-- other column/table in this schema is touched.
ALTER TABLE commercial_notifications
  DROP CHECK commercial_notifications_event_type_check,
  ADD CONSTRAINT commercial_notifications_event_type_check CHECK (
    event_type IN ('QUOTE_READY', 'PAYMENT_CONFIRMED', 'ENTITLEMENT_INCREASED', 'PAYMENT_FAILED', 'REQUEST_DENIED', 'QUOTE_EXPIRED', 'RENEWAL_UPCOMING')
  );
