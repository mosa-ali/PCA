// Canonical-schema-wide complement to
// test/childprofiles/noReadableChildFieldsRegression.test.mjs (which guards
// only family_child_memberships and its dedicated repository/service/route
// files). This test scans backend/src/db/schema.ts's PCA_CANONICAL_SCHEMA --
// every column of all 75 tables -- for the same class of prohibited
// central-child-data field names, so a FUTURE migration/table cannot
// silently introduce one without also updating this explicit allowlist.
//
// Per the mission that produced schema.ts: "Do not use this token list
// blindly against unrelated text columns; scope it to central child/family
// data tables and explicit architectural rules." A bare substring match
// against 626 real column names produces mostly false positives (e.g.
// "managed_device_limit" contains "age"; "entitlement_type" contains
// "title"). Every match below was individually verified against the
// originating migration's own comments (see
// docs/database/PCA_CENTRAL_DATA_PRIVACY_CLASSIFICATION.csv and
// docs/database/PCA_CANONICAL_SCHEMA_REPORT.md) and is either a genuine
// false positive (documented) or a column that is NOT readable child
// personal content despite containing the substring (documented, with the
// migration citation). No entry may be added to ALLOWED_FALSE_POSITIVES
// without that same standard of evidence.
import assert from 'node:assert/strict';
import test from 'node:test';
import { PCA_CANONICAL_SCHEMA } from '../dist/db/schema.js';

const PROHIBITED_TERMS = [
  'display_name', 'nickname', 'dob', 'birth_date', 'birthdate', 'age', 'gender', 'school',
  'photo', 'avatar', 'message', 'browsing_history', 'app_usage_history', 'usage_history',
  'precise_location', 'camera_frame', 'camera', 'face', 'url', 'title', 'search', 'location',
  'usage', 'policy', 'pin', 'private_key', 'fdek', 'recovery_secret',
];

// table.column -> why this substring match is not a privacy violation, with
// a citation. Verified once, by hand, against migration source during the
// PCA-LIVE-DB-0 canonical-schema mission; see
// docs/database/PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md and
// PCA_CANONICAL_SCHEMA_REPORT.md for the full analysis this allowlist is
// drawn from.
const ALLOWED_FALSE_POSITIVES = {
  // "age" substring false positives: the real word is "manage/managed" or "storage", not age data.
  'account_entitlements.managed_device_limit': 'age',
  'account_entitlements.managed_device_active_count': 'age',
  'account_entitlements.managed_device_reserved_count': 'age',
  'account_entitlements.over_limit_managed_device': 'age',
  'billing_plans.default_managed_device_limit': 'age',
  'entitlement_activation_idempotency.applied_managed_device_limit': 'age',
  'entitlement_defaults.managed_device_limit': 'age',
  'parent_accounts.default_managed_device_limit': 'age',
  'parent_account_preferences.language_code': 'age',
  'family_rbac_policy_config.administrator_can_manage_viewers': 'age',
  'release_current_pointers.package_type': 'age',
  'release_packages.package_type': 'age',
  // "title" substring false positives: the real word is "entitlement", never a page/video title (same finding as backend/test/schema-privacy.test.mjs's own documented "title" exclusion for migration 0005).
  'billing_refunds.entitlement_treatment': 'title',
  'complimentary_entitlement_grants.entitlement_type': 'title',
  // "message"/"age" substrings: opaque idempotency/dedup identifiers, never message content -- migration 0001 TYPE DECISIONS (message_id is an opaque bounded application identifier) and migration 0012 (message_key is a closed enum-like localization key, never free-text). Each matches BOTH terms ("message" and "age", the latter via "message" containing "...ess age..." across the token boundary is not real -- "message_id"/"message_key" contain the substring "age" directly), so each needs both listed.
  'commercial_notifications.message_key': ['message', 'age'],
  'envelope_message_idempotency_ledger.message_id': ['message', 'age'],
  'relay_envelopes.message_id': ['message', 'age'],
  // "policy" substring: a named closed-enum tier/profile selection, never stored activity/browsing policy content.
  'enrollment_invitations.initial_policy_profile': 'policy',
  // "age" substring on a closed UX-tier enum (YOUNG_CHILD/TEEN), never an actual age/DOB -- migration 0019: "No display name, activity, location, or readable child content is stored here."
  'enrollment_invitations.age_ux_tier': 'age',
  // "display_name": a Platform Admin STAFF member's own chosen name, not a parent or child.
  'platform_admin_accounts.display_name': 'display_name',
};

function isAllowedFalsePositive(key, term) {
  const allowed = ALLOWED_FALSE_POSITIVES[key];
  if (allowed === undefined) return false;
  return Array.isArray(allowed) ? allowed.includes(term) : allowed === term;
}

test('no column in the canonical schema is a prohibited readable central child/family field, except a documented, individually-verified false positive', () => {
  const offenders = [];
  for (const table of PCA_CANONICAL_SCHEMA) {
    for (const column of table.columns) {
      const name = column.name.toLowerCase();
      for (const term of PROHIBITED_TERMS) {
        if (!name.includes(term)) continue;
        const key = `${table.name}.${column.name}`;
        if (isAllowedFalsePositive(key, term)) continue;
        offenders.push(`${key} (matched "${term}", privacy class: ${column.privacy})`);
      }
    }
  }
  assert.deepEqual(offenders, [], `prohibited or unreviewed field name(s) found in canonical schema:\n${offenders.join('\n')}`);
});

test('every allowlisted false positive still exists in the canonical schema with the expected privacy class (catches a stale allowlist entry)', () => {
  const byKey = new Map();
  for (const table of PCA_CANONICAL_SCHEMA) {
    for (const column of table.columns) byKey.set(`${table.name}.${column.name}`, column);
  }
  const stale = [];
  for (const key of Object.keys(ALLOWED_FALSE_POSITIVES)) {
    if (!byKey.has(key)) stale.push(key);
  }
  assert.deepEqual(stale, [], `allowlist entries no longer present in the canonical schema (remove them):\n${stale.join('\n')}`);
});

test('zero columns are classified READABLE_CHILD_DATA in the canonical schema', () => {
  const readableChild = [];
  for (const table of PCA_CANONICAL_SCHEMA) {
    for (const column of table.columns) {
      if (column.privacy === 'READABLE_CHILD_DATA') readableChild.push(`${table.name}.${column.name}`);
    }
  }
  assert.deepEqual(readableChild, []);
});
