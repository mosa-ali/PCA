# iOS Local Persistence — Architecture Handoff

Owning work item: **PCA-LOCAL-DB-1** (Android lane). Written from Windows with no
Mac/Xcode toolchain available -- per PCA-LOCAL-DB-1 Section 27 this is a concise
architecture handoff only, not a compiled implementation.

`IOS_LOCAL_DB_IMPLEMENTATION = BLOCKED_EXTERNAL_PLATFORM_VALIDATION`

## 1. What Android built (for parity reference)

`PcaLocalDatabase` (Room, `android/app/src/main/java/org/pca/app/persistence/`):
17 tables implementing doc 10's logical local data model, field-level
encryption-at-rest for sensitive columns via an `AndroidKeystoreLocalRecordCipher`
(AES/GCM, non-exportable Keystore key), a `RetentionEngine` implementing doc 11's
deletion algorithm with calendar-accurate cutoff math, a `DeleteNowCoordinator`
for transactional per-device/per-child/per-family wipes, and a durable
`sync_outbox_records`/`sync_receipt_records` pair for the E2EE family sync queue.

## 2. Equivalent iOS shape

- **Storage engine**: Core Data (SQLite store) or a raw SQLite.swift/GRDB
  wrapper -- doc 10 Section 11 leaves engine selection to the platform doc
  (doc 07), same as Android's doc 06. GRDB is a reasonable Room-equivalent
  (typed row mapping, migration support, transaction API); Core Data is the
  more "platform-default" choice but has heavier magic around relationship
  faulting that doc 10's flat entity list doesn't need.
- **The same 17 logical tables** (doc 10 Sections 3-5 + PCA-LOCAL-DB-1
  Section 5's candidate list): Family, FamilyMember, Device, Policy(Snapshot),
  UsageSession, WebVisit, ContentBlockEvent, LocationPoint, BreakSession,
  ProximityEvent, PrayerReminderEvent, DeviceKeyMetadata, PolicyReceipt,
  TamperEvent, ParentActionAudit, RetentionDeletionReceipt,
  SyncOutboxRecord, SyncReceiptRecord. Field names/types should mirror the
  Kotlin entities in `android/app/src/main/java/org/pca/app/persistence/entity/`
  1:1 where Swift/Core Data types allow, so sync-format alignment (both
  devices describing "the same shaped record") is trivial to audit later.
- **Encryption-at-rest boundary**: a `LocalRecordCipher`-equivalent Swift
  protocol (`encrypt(String) -> EncryptedField`, `decrypt(EncryptedField) -> String`),
  backed by a Keychain-stored (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`,
  non-synchronizable) AES-GCM key via `CryptoKit.SymmetricKey` generated once
  and never exported. This is the direct analogue of
  `AndroidKeystoreLocalRecordCipher` -- same non-exportable-key,
  application-level-field-encryption approach (doc 10 Section 13
  PCA-DEC-022 option (b), not a claim on `PRODUCTION_CRYPTO_SUITE`).
  Sensitive fields (displayName, domain/url/title, latitude/longitude,
  app/category token, envelope ciphertext, audit reason text) get the same
  encrypted-column-pair treatment as the Android entities.
- **Retention engine**: same calendar-accurate cutoff math (doc 11 Section
  5.1/PCA-DATA-030) -- `Calendar`/`DateComponents` with an explicit
  `TimeZone` give the same "1/3/6/9 months calendar-accurate, clamped to
  month-end" semantics as Android's `java.time.Period`; 14 days stays an
  exact `TimeInterval` subtraction. Audit floor (`max(generalWindow, 12mo)`)
  and the `LocationPoint` "keep latest only" rolling mode port directly.
- **Delete Now**: same transactional, receipt-producing coordinator shape --
  wrap each scope (device/child/family) in one `NSManagedObjectContext`
  transaction (or one GRDB `write` block), never leave a partial delete on
  interruption.
- **Migrations**: Core Data lightweight migration (or GRDB's migration
  DSL) plays the same role as Room's `exportSchema`/`Migration` pair --
  MUST NOT use Core Data's "destroy and rebuild store" as a silent
  fallback, matching PCA-LOCAL-DB-1 Section 4's Room rule.

## 3. Explicitly NOT done here

No Swift/Core Data/GRDB code, no `.xcdatamodeld`, no Xcode project changes.
This file is the only iOS-lane artifact from this work item. A Mac-based
session (or the `claude-7-parent-web`/other iOS-capable lane, per
coordinator assignment) should treat this as the starting spec, not
translate it mechanically without re-validating against doc 07's own
platform-capability notes (e.g. iOS Family Controls' different usage/app
visibility model than Android UsageStatsManager -- doc 10 Section 12's
platform-limitation table already flags this as a doc 06/07-owned
divergence, not something this handoff resolves).

## 4. Coordinator integration actions

- `WELL1_ROOM_INTEGRATION_REQUIRED`: none identified this pass --
  `feature/wellbeing/**` was not touched (PCA-LOCAL-DB-1 Section 26); if a
  future wellbeing feature needs durable Room-backed storage, it should get
  new DAOs/entities added to `PcaLocalDatabase` rather than a second Room
  database, and Coordinator should route that request here.
- iOS lane: assign to a Mac-capable session/agent; this document is its
  starting brief.
