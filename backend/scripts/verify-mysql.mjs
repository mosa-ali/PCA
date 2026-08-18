// Disposable-database migration/privacy gate, run as part of `npm run
// test:db`. Applies every migration to a fresh database (the Compose test
// service, or an explicitly-allowed local host) and asserts the resulting
// table set is exactly the expected minimal central schema -- catches an
// accidental new table (a privacy/scope regression) as fast as a broken
// migration.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

// PCA_MIGRATION_DATABASE_URL, if set, is a distinct, more-privileged
// migration/provisioning credential, separate from the least-privilege
// runtime credential the application itself uses (PCA_DATABASE_URL, read
// by backend/src/db/pool.ts, which this script never touches). Production
// SHOULD set this to a dedicated credential; local/dev/CI MAY simply not
// set it and collapse both roles onto PCA_DATABASE_URL -- this fallback
// keeps every existing workflow that only sets PCA_DATABASE_URL working
// completely unchanged. The hostname allowlist below is validated against
// whichever URL is actually used, so this disposable-database gate can
// never accidentally run against a non-local/non-Compose host either way.
const connectionString = process.env.PCA_MIGRATION_DATABASE_URL ?? process.env.PCA_DATABASE_URL;
if (!connectionString) throw new Error('PCA_DATABASE_URL (or PCA_MIGRATION_DATABASE_URL) is required for the disposable database test.');
const url = new URL(connectionString);
if (!['127.0.0.1', 'localhost', 'mysql'].includes(url.hostname)) {
  throw new Error('PCA_DATABASE_URL/PCA_MIGRATION_DATABASE_URL must point to the disposable local/Compose database.');
}

const root = new URL('../migrations/', import.meta.url);
const files = (await readdir(root)).filter((file) => file.endsWith('.sql')).sort();
const connection = await mysql.createConnection({ uri: connectionString, multipleStatements: true, timezone: 'Z' });
try {
  for (const file of files) {
    const migration = await readFile(fileURLToPath(new URL(file, root)), 'utf8');
    await connection.query(migration);
    await connection.query('INSERT INTO schema_migrations(version) VALUES (?)', [file]);
  }
  const [rows] = await connection.query(
    `SELECT table_name AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name`,
  );
  const actual = rows.map((row) => row.table_name).join(',');
  const expected =
    'account_entitlements,billing_commercial_markets,billing_country_market_rules,billing_currencies,billing_disputes,billing_invoice_lines,billing_invoices,billing_payment_attempts,billing_payment_methods,billing_payment_transactions,billing_plans,billing_price_books,billing_provider_events,billing_quotes,billing_refund_operations,billing_refunds,billing_subscriptions,commercial_notifications,complimentary_entitlement_grants,device_challenges,device_public_keys,devices,enrollment_bootstrap_attempts,enrollment_invitation_transitions,enrollment_invitations,entitlement_activation_idempotency,entitlement_change_request_transitions,entitlement_change_requests,entitlement_defaults,envelope_data_version_ledger,envelope_message_idempotency_ledger,envelope_replay_ledger,families,family_authority_attestations,family_authority_chain_heads,family_authority_genesis_anchors,licenses,managed_device_slot_reservations,parent_account_preferences,parent_accounts,parent_email_verification_codes,platform_admin_accounts,platform_admin_audit_events,platform_admin_login_attempts,platform_admin_mfa_state,platform_admin_role_assignments,platform_admin_security_alerts,platform_admin_sessions,platform_admin_settings,platform_admin_step_up_sessions,recovery_envelopes,relay_envelopes,release_current_pointers,release_packages,safe_zones,schema_migrations,security_audit_metadata,service_account_family_scopes,service_accounts,service_sessions,settlement_accounts,settlement_batch_items,settlement_batches,settlement_fx_snapshots,sync_sequence_progress_ledger';
  if (actual !== expected) throw new Error(`Unexpected schema: ${actual}`);
  console.log(`MySQL migration/privacy gate passed (${files.length} migration(s)).`);
} finally {
  await connection.end();
}
