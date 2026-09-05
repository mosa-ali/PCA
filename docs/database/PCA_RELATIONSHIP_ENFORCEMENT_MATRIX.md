# PCA Relationship Enforcement Matrix

Every column across the 75-table canonical schema that is shaped like a
reference to another table's identity (`*_id`/`*_ref`) is classified below as
one of:

- **DB_FOREIGN_KEY_REQUIRED** — a real `FOREIGN KEY ... REFERENCES` exists
  (or must exist) in the canonical schema.
- **APPLICATION_ENFORCED_INTENTIONAL** — no FK exists, and a specific,
  evidenced architectural reason for that is cited below (a migration
  comment, a test, or a source file).
- **OWNER_DECISION_REQUIRED** — no FK exists, the columns are type-compatible
  (an FK is structurally possible), and no explicit rationale was found in
  the repository. Flagged for the owner to decide: add the FK, or record why
  not.

This mission does not add, remove, or "improve" any relationship on its own
authority — every relationship below was left exactly as the accepted
migration history built it, classified against Database A (a disposable
MySQL 8.4 instance with every migration applied from zero), **except** the
one case the original mission flagged `OWNER_DECISION_REQUIRED` (formerly
§8 below), which the owner then explicitly decided via a new migration —
see the note at the end of this document.

## 1. DB_FOREIGN_KEY_REQUIRED — the 83 declared foreign keys

All 83 are `ON UPDATE NO ACTION ON DELETE NO ACTION` (no `CASCADE` anywhere —
deletes/updates across these relationships are always application-managed,
never DB-cascaded). Representative examples (full list is the
`foreignKeys` array of every table in `backend/src/db/schema.ts` /
`docs/database/_work/database_A_introspection.json`):

| Table.Column | → Referenced |
|---|---|
| `device_challenges.device_id` | `devices.device_id` |
| `device_public_keys.device_id` | `devices.device_id` |
| `devices.registered_by_account_id` | `service_accounts.account_id` (migration 0026) |
| `enrollment_bootstrap_attempts.device_id` | `devices.device_id` |
| `enrollment_bootstrap_attempts.invitation_id` | `enrollment_invitations.invitation_id` (migration 0037 — owner decision, see the closing note) |
| `managed_device_slot_reservations.family_id` → *(see §3, this one is NOT an FK — contrast case)* | — |
| ...75 more, spanning billing line-items→invoices, settlement batch-items→batches, platform-admin role assignments→accounts, etc. | |

These are the "obvious" cases: a child row that cannot outlive its parent
within the same bounded subsystem, using matching opaque-ID types. Full
enumeration is in the generated artifacts, not hand-duplicated here to avoid
drift between this document and the schema.

## 2. The single dominant pattern: soft `family_id` scoping (30 tables)

**Classification: APPLICATION_ENFORCED_INTENTIONAL.**

Every family-scoped table in the schema stores `family_id` as
`VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin` — **never** as a
foreign key into `families.family_id`, which is itself
`CHAR(36) CHARACTER SET ascii COLLATE ascii_bin` (the opaque identity value).
Zero of the 83 foreign keys in the schema reference `families`. This is not
30 independent omissions; it is one deliberate, explicitly-documented,
schema-wide convention, evidenced by:

- **Migration 0036** (`family_child_memberships`), verbatim: *"No FK to
  families(family_id): verified against every other family-scoped table in
  this schema (enrollment_invitations, devices, device_challenges,
  relay_envelopes, recovery_envelopes, eye_protection_settings) -- NONE
  declares one. families.family_id is CHAR(36) ascii_bin (the opaque identity
  itself); every OTHER table's family_id column is VARCHAR(128) utf8mb4_bin
  ... and MySQL rejects an FK across that charset/collation difference
  outright. An index, not a foreign key, is this schema's consistent
  mechanism for a family-scoped column — membership existence is checked at
  the application layer (AuthzService's requiresFamilyScope)."*
- **Migration 0027** (`family_member_invitations`), verbatim, generalizing the
  same rule even where types DO match exactly: *"No FOREIGN KEY to
  families/parent_accounts, matching this schema's established convention of
  soft (unenforced) family_id references across domain boundaries — see
  enrollment_invitations, devices, etc., none of which FK to families
  either."*
- **Migration 0013** (`parent_accounts`): *"No FOREIGN KEY into any
  family-plane table exists (the family/commercial [authority chain resolves
  ownership independently])."*
- **Migration 0001**'s own TYPE DECISIONS section pre-declares this pattern
  from the very first migration: opaque bounded application identifiers
  (`family_id`, sender/recipient device id, `message_id`, `release_id`,
  `signing_key_id`, `public_key`) are deliberately `VARCHAR(n)
  utf8mb4_bin`, distinct from the narrower `CHAR(36) ascii_bin` identity
  columns, specifically so they are never DB-joinable to the identity tables.

Applies to the `family_id` column on: `account_entitlements`,
`complimentary_entitlement_grants`, `device_challenges`,
`device_protection_status`, `devices`, `enrollment_administration_verifiers`,
`enrollment_bootstrap_attempts`, `enrollment_invitations`,
`enrollment_protection_approval_requests`,
`entitlement_activation_idempotency`, `entitlement_change_requests`,
`envelope_data_version_ledger`, `envelope_message_idempotency_ledger`,
`envelope_replay_ledger`, `eye_protection_settings`, `family_audit_events`,
`family_authority_genesis_anchors`, `family_child_memberships`,
`family_member_invitations` (`CHAR(36)`, matching type — still unenforced,
per 0027 above), `family_rbac_policy_config` (`CHAR(36)`),
`managed_device_slot_reservations`, `parent_accounts` (`CHAR(36)`),
`protection_alerts`, `recovery_envelopes`, `relay_envelopes`,
`safe_zones`, `service_account_family_scopes`, `sync_sequence_progress_ledger`.
(`family_authority_attestations`/`family_authority_chain_heads` use
`family_id` as part of a composite PK against their own genesis anchor —
same convention, no FK to `families`.)

**Do not add an FK to `families.family_id` anywhere in the bootstrap.** Family
membership existence is, and must remain, an application-layer check
(`AuthzService.requiresFamilyScope`).

## 3. Opaque device/key/message identifiers (schema-wide, migration 0001 design)

**Classification: APPLICATION_ENFORCED_INTENTIONAL**, cited to migration
0001's TYPE DECISIONS section (opaque bounded application identifiers are
`VARCHAR(n) utf8mb4_bin` by design, distinct from the `CHAR(36) ascii_bin`
identity columns they logically correspond to) plus each table's own
"opaque ... routing metadata, never readable ... detail" framing:

| Table.Column | Logical referent | Evidence |
|---|---|---|
| `relay_envelopes.sender_device_id` / `.recipient_device_id` | `devices.device_id` | Migration 0001 TYPE DECISIONS |
| `release_packages.signing_key_id` | `device_public_keys.key_id` | Migration 0001 TYPE DECISIONS; also structurally infeasible as a plain FK — `device_public_keys`' PK is composite `(device_id, key_id)` |
| `family_audit_events.parent_device_id` | `devices.device_id` | Migration 0028: "opaque ciphertext and typed routing metadata (family/parent-device/key-epoch), never a readable ... value"; mirrors 0025 exactly |
| `protection_alerts.device_id` / `.parent_device_id` | `devices.device_id` | Migration 0025: "stores only opaque ciphertext and typed routing metadata (family/device/trigger/epoch), never readable family detail" |
| `enrollment_protection_approval_requests.device_id` / `.decided_by_device_id` / `.child_id` | `devices.device_id` / `family_child_memberships.child_profile_id` | Migration 0022: "stores opaque child/device references" |
| `safe_zones.recipient_endpoint_id` | a device/browser endpoint (mobile or `platform='BROWSER'` row in `devices`, per migration 0026) | Migration 0020: "stores only opaque routing/version metadata and an encrypted payload. It must never hold a readable label, coordinate, radius, or child-location policy" |

## 4. Cross-plane isolation (billing/commercial ↔ family/entitlements)

**Classification: APPLICATION_ENFORCED_INTENTIONAL.** The billing/commercial
plane and the family/entitlements plane are deliberately never joined by FK,
mirroring the same data-minimization posture as §2/§3:

| Table.Column | Logical referent | Evidence |
|---|---|---|
| `commercial_notifications.account_ref` | a parent/service account | Migration 0012, verbatim: *"deliberately NOT a `family_id` FOREIGN KEY into the family/parent plane, the same commercial/family-plane isolation billing_core's own schemaPrivacy test enforces"*; confirmed by `backend/test/commercialnotifications/schemaPrivacy.test.mjs` |
| `billing_invoices.account_ref`, `billing_payment_attempts.account_ref`, `billing_payment_methods.account_ref`, `billing_subscriptions.account_ref` | a parent/service account | Same billing_core schemaPrivacy convention (`backend/test/billing/schemaPrivacy.test.mjs`, `backend/test/db/billingCoreSchemaPrivacy.mysql.test.mjs`) |
| `billing_payment_attempts.increase_request_ref`, `billing_quotes.increase_request_ref` | `entitlement_change_requests.request_id` | `backend/src/billing/entitlementContract.ts:21`, verbatim: *"Opaque identifier of the entitlement increase-request this payment corresponds to, if any (bounded VARCHAR, no FK — see billing_quotes.increase_request_ref / billing_payment_attempts.increase_request_ref)"* |
| `entitlement_change_requests.quote_ref` | `billing_quotes.quote_id` | Same billing/entitlements plane-isolation convention as the row above (reverse direction) |
| `account_entitlements.plan_ref` | `billing_plans.plan_id` | Same convention — `plan_ref` is a bounded `VARCHAR(32)` enum-like plan code (e.g. `FREE_STARTER`), not `billing_plans`' opaque `CHAR(36)` row id; type-incompatible by design |

External-provider correlation columns (`billing_*.provider_*_ref`,
`billing_provider_events.provider_event_id`,
`platform_admin_*.correlation_id`, `security_audit_metadata.correlation_id`)
are **not relationships at all** — they hold an external payment provider's
own reference string or a cross-cutting trace id, never a PCA table's primary
key, and are out of scope for this matrix.

## 5. Cryptographic self-certification substitutes for DB referential integrity

**Classification: APPLICATION_ENFORCED_INTENTIONAL.**

`family_authority_genesis_anchors.genesis_device_id`/`.genesis_dsk_key_id`,
`family_authority_attestations.owner_device_id`/`.signer_device_id`/
`.owner_dsk_key_id`/`.signer_dsk_key_id`, and
`family_authority_attestations.previous_attestation_id` (a self-referential
hash-chain pointer) are all type-compatible with a real FK
(`CHAR(36)`/`CHAR(64)` `ascii_bin`, matching exactly) but none is declared.
Migration 0011's header is explicit about why DB referential integrity is not
the enforcement mechanism here: every row is either a self-certified genesis
anchor or an already signature-verified attestation that
`FamilyOwnerAttestationChainEngine` — the *only* writer — appends "only after
checking it traces back to that anchor." The chain's integrity is
cryptographic (Ed25519-style device-signature verification over the
canonical tuple), not referential; a dangling `signer_device_id` would still
fail signature verification before ever being written. Adding an FK here
would not strengthen the actual security property and was evidently a
deliberate omission consistent with §2/§3's schema-wide soft-reference
convention.

## 6. Reservation-before-existence ordering (explicit, cited)

**Classification: APPLICATION_ENFORCED_INTENTIONAL.**

`managed_device_slot_reservations.invitation_id` → `enrollment_invitations.invitation_id`:
migration 0006, verbatim: *"invitation_id is DELIBERATELY NOT foreign-keyed to
enrollment_invitations: PCA-ADD-PA-022/038 requires the reservation to be
created and committed BEFORE the invitation it is bound to is ever
persisted (reserve first, only create a usable invitation if the reservation
succeeds — never the reverse)."* An FK would make row creation order matter
in exactly the way this design deliberately avoids.

## 7. Explicit, cited non-backfill (post-hoc registry table)

**Classification: APPLICATION_ENFORCED_INTENTIONAL**, but flagged distinctly
because the rationale is operational/historical rather than architectural:

`enrollment_invitations.child_profile_id` → `family_child_memberships.child_profile_id`
(types match exactly: `VARCHAR(128) utf8mb4_bin` both sides). Migration
0036, verbatim: *"NO foreign key is added from enrollment_invitations.
child_profile_id to this table in this migration. That relationship is
enforced at the application layer (InvitationService, verified by
backend/test/childprofiles and backend/test/invitation) rather than at the
schema layer, because enrollment_invitations already carries rows (pre-PPR-2
dev/fixture data, format-validated but not minted by this registry) whose
child_profile_id values this table cannot retroactively host without risking
a false cross-family bind — see
docs/pre-production/PCA_PPR2_OWNER_DECISIONS.md Part F."*

`eye_protection_settings.child_profile_id` → the same registry (types also
match exactly) is not individually named in 0036's comment, but was created
by migration 0032 using the identical `child_profile_id` convention
established by 0019, three migrations before the registry (0036) existed —
i.e. it necessarily predates the registry table too, for the same reason.
Classified the same way by direct extension of the cited rationale, not
independently re-verified against fixture data.

## 8. OWNER_DECISION_REQUIRED — RESOLVED (was: no rationale found)

**Status: closed by owner decision, migration `0037`.** This section is
kept for audit history — it originally read as follows, and the decision
recorded at the end is what happened next.

Exactly one relationship in the entire 75-table schema ever fell into this
bucket:

| Table.Column | Target | Why this was flagged |
|---|---|---|
| `enrollment_bootstrap_attempts.invitation_id` | `enrollment_invitations.invitation_id` | Types match exactly (`CHAR(36) ascii_bin` both sides). The same table's `device_id` column **does** carry a real FK to `devices.device_id` (migration 0003), so this was not a "this whole table avoids FKs" pattern — `invitation_id` was the one column singled out without one. Migration 0003's header describes writing this row "in the SAME transaction as invitation redemption," at which point the invitation row already exists and is merely being transitioned to `REDEEMED` (not deleted), so the §6 reservation-before-existence rationale did not apply here. No comment, test, or design doc was found explaining the omission. |

**Owner decision (PCA-LIVE-DB-0 closure pass)**: add the FK. Reason given:
types match exactly; the invitation exists before the bootstrap-attempt
insert; both are written/redeemed in the same transaction; runtime
replay/recovery already `INNER JOIN`s the attempt back to the invitation;
no architectural rationale exists for allowing an orphan attempt.
Implemented as `backend/migrations/0037_enrollment_bootstrap_attempt_invitation_fk.sql`
(an explicit index plus `FOREIGN KEY (invitation_id) REFERENCES
enrollment_invitations (invitation_id) ON UPDATE NO ACTION ON DELETE NO
ACTION`, additive — migration 0003 was not retroactively edited). Full
migration-from-zero, canonical-bootstrap-from-zero, `EXACT_MATCH`,
negative-control, and test-suite re-verification all passed afterward —
see `PCA_CANONICAL_SCHEMA_REPORT.md` §18 for the complete record.
`enrollment_bootstrap_attempts.invitation_id` is now correctly classified
under §1 (`DB_FOREIGN_KEY_REQUIRED`), not here.

## Summary

- **DB_FOREIGN_KEY_REQUIRED**: 83 (all present, all `NO ACTION`/`NO ACTION`
  — includes `enrollment_bootstrap_attempts.invitation_id` as of migration
  `0037`, §8).
- **APPLICATION_ENFORCED_INTENTIONAL**: 56 total — every soft `family_id`
  reference (30 tables), every opaque device/key/message identifier (§3),
  every cross-plane billing/entitlements reference (§4), the
  family-authority signature chain (§5), the slot-reservation ordering case
  (§6), and the child-profile-registry non-backfill case (§7). Counted
  directly from `backend/src/db/schema.ts`'s `applicationEnforcedRelations`
  arrays (also reflected in `docs/database/PCA_CANONICAL_DATABASE_OBJECT_INVENTORY.csv`'s
  56 `APPLICATION_ENFORCED_RELATION` rows, all of which carry this status).
- **OWNER_DECISION_REQUIRED**: 0 (was 1 — `enrollment_bootstrap_attempts.invitation_id`,
  resolved in §8 above).
