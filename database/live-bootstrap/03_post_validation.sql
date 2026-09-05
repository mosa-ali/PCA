-- database/live-bootstrap/03_post_validation.sql
--
-- Run this AFTER 01_create_database_schema.sql and 02_reference_data.sql.
-- Every check fails CLOSED (SIGNAL), exactly like 00_preflight.sql. If ANY
-- check fails here, the bootstrap is NOT complete and NOT safe to hand to
-- the application -- do not proceed to the application connection smoke
-- test in OWNER_RUNBOOK.md.
--
-- These exact counts (75 tables / 626 columns / 82 foreign keys / 31 unique
-- indexes / 116 non-unique indexes / 14 reference rows / 34 bookkeeping
-- rows) were captured by this mission from Database A (all 34 migrations
-- applied from zero) and proven identical on Database B (this bootstrap
-- package applied from zero) via backend/scripts/compare-schema-snapshots.mjs
-- reporting EXACT_MATCH. If a future migration changes the schema, these
-- counts (and database/live-bootstrap/*.sql, and backend/src/db/schema.ts)
-- must be regenerated together -- see OWNER_RUNBOOK.md's FUTURE CHANGES
-- section. A mismatch here after a deliberate schema change is expected and
-- correct; investigate only if unexpected.

DELIMITER $$
DROP PROCEDURE IF EXISTS _pca_postvalidate_assert $$
CREATE PROCEDURE _pca_postvalidate_assert(IN condition_met BOOLEAN, IN message VARCHAR(128))
BEGIN
  IF NOT condition_met THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = message;
  END IF;
END $$
DELIMITER ;

-- 1. Exact table count.
CALL _pca_postvalidate_assert(
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE') = 75,
  'POST-VALIDATION FAILED: expected exactly 75 base tables.'
);

-- 2. Exact table name set (order-independent, via GROUP_CONCAT of a sorted
-- list -- mirrors backend/scripts/verify-mysql.mjs's own established
-- pattern for this same check). MySQL's group_concat_max_len defaults to
-- 1024 bytes, which silently truncates a 75-table name list mid-string
-- (confirmed while testing this file: the comparison failed until this was
-- raised) -- always widen it before relying on GROUP_CONCAT for a
-- completeness check like this one.
SET SESSION group_concat_max_len = 8192;
SET @actual_tables = (
  SELECT GROUP_CONCAT(table_name ORDER BY table_name SEPARATOR ',')
  FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
);
SET @expected_tables = 'account_entitlements,billing_commercial_markets,billing_country_market_rules,billing_currencies,billing_disputes,billing_invoice_lines,billing_invoices,billing_payment_attempts,billing_payment_methods,billing_payment_transactions,billing_plans,billing_price_books,billing_provider_events,billing_quotes,billing_refund_operations,billing_refunds,billing_subscriptions,commercial_notifications,complimentary_entitlement_grants,device_challenges,device_protection_status,device_public_keys,devices,enrollment_administration_verifiers,enrollment_bootstrap_attempts,enrollment_invitation_transitions,enrollment_invitations,enrollment_protection_approval_requests,entitlement_activation_idempotency,entitlement_change_request_transitions,entitlement_change_requests,entitlement_defaults,envelope_data_version_ledger,envelope_message_idempotency_ledger,envelope_replay_ledger,eye_protection_settings,families,family_audit_events,family_authority_attestations,family_authority_chain_heads,family_authority_genesis_anchors,family_child_memberships,family_member_invitations,family_rbac_policy_config,licenses,managed_device_slot_reservations,parent_account_preferences,parent_accounts,parent_email_verification_codes,parent_password_reset_codes,platform_admin_accounts,platform_admin_audit_events,platform_admin_login_attempts,platform_admin_mfa_state,platform_admin_role_assignments,platform_admin_security_alerts,platform_admin_sessions,platform_admin_settings,platform_admin_step_up_sessions,protection_alerts,recovery_envelopes,relay_envelopes,release_current_pointers,release_packages,safe_zones,schema_migrations,security_audit_metadata,service_account_family_scopes,service_accounts,service_sessions,settlement_accounts,settlement_batch_items,settlement_batches,settlement_fx_snapshots,sync_sequence_progress_ledger';
CALL _pca_postvalidate_assert(@actual_tables = @expected_tables, 'POST-VALIDATION FAILED: table name set does not exactly match the expected 75.');

-- 3. Exact column count.
CALL _pca_postvalidate_assert(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE()) = 626,
  'POST-VALIDATION FAILED: expected exactly 626 columns across all tables.'
);

-- 4. Exact foreign key count.
CALL _pca_postvalidate_assert(
  (SELECT COUNT(DISTINCT constraint_name) FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE()) = 82,
  'POST-VALIDATION FAILED: expected exactly 82 foreign keys.'
);

-- 5. Exact non-PRIMARY unique/non-unique index counts.
CALL _pca_postvalidate_assert(
  (SELECT COUNT(*) FROM (
    SELECT DISTINCT table_name, index_name FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND index_name <> 'PRIMARY' AND non_unique = 0
  ) x) = 31,
  'POST-VALIDATION FAILED: expected exactly 31 unique (non-PK) indexes.'
);
CALL _pca_postvalidate_assert(
  (SELECT COUNT(*) FROM (
    SELECT DISTINCT table_name, index_name FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND index_name <> 'PRIMARY' AND non_unique = 1
  ) x) = 116,
  'POST-VALIDATION FAILED: expected exactly 116 non-unique indexes.'
);

-- 6. Every table is InnoDB / utf8mb4 / utf8mb4_bin (no exceptions).
CALL _pca_postvalidate_assert(
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
     AND (engine <> 'InnoDB' OR table_collation <> 'utf8mb4_bin')) = 0,
  'POST-VALIDATION FAILED: a table is not InnoDB/utf8mb4_bin.'
);

-- 7. Required reference-data row counts (see PCA_PRODUCTION_REFERENCE_DATA_MATRIX.csv).
CALL _pca_postvalidate_assert((SELECT COUNT(*) FROM billing_currencies) = 3, 'POST-VALIDATION FAILED: billing_currencies must have exactly 3 rows.');
CALL _pca_postvalidate_assert((SELECT COUNT(*) FROM billing_commercial_markets) = 3, 'POST-VALIDATION FAILED: billing_commercial_markets must have exactly 3 rows.');
CALL _pca_postvalidate_assert((SELECT COUNT(*) FROM billing_country_market_rules) = 7, 'POST-VALIDATION FAILED: billing_country_market_rules must have exactly 7 rows.');
CALL _pca_postvalidate_assert((SELECT COUNT(*) FROM entitlement_defaults) = 1, 'POST-VALIDATION FAILED: entitlement_defaults must have exactly 1 row.');
CALL _pca_postvalidate_assert((SELECT COUNT(*) FROM schema_migrations) = 34, 'POST-VALIDATION FAILED: schema_migrations must have exactly 34 bookkeeping rows.');

-- 8. No test/demo data anywhere: every table OTHER than the five reference
-- tables above must be completely empty immediately after bootstrap (mission
-- requirement: no test accounts, demo parents/children, fake
-- devices/invitations/licenses/entitlements, QA credentials). This needs a
-- dynamic per-table COUNT(*) loop, which plain portable SQL cannot express
-- without dynamic-SQL stored-procedure privileges that are not guaranteed
-- across every hosting provider -- it is NOT expressed here as SQL (an
-- empty/inert placeholder here would look like a real check without being
-- one). It is fully implemented, and is a hard requirement of this
-- post-validation step, in
-- `PCA_DATABASE_URL=... node backend/scripts/post-validate.mjs` -- see
-- OWNER_RUNBOOK.md's "Post-validation" step, which runs both this file and
-- that script and requires both to pass.

DROP PROCEDURE _pca_postvalidate_assert;

SELECT 'PCA-LIVE-DB-0 POST-VALIDATION (SQL-checkable subset): ALL CHECKS PASSED' AS result,
       'Run backend/scripts/post-validate.mjs for the full check, including per-table emptiness and the schema fingerprint.' AS next_step;
