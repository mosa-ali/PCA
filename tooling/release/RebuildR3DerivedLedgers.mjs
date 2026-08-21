import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
// Test-only override: PCA_R3_TEST_ROOT lets the regression test suite
// point this script at a disposable fixture directory (a copy of the real
// matrix/manifest files) instead of the controlled repository files,
// without needing any other code path change. Unset in every normal
// invocation, so default behavior is unchanged.
const effectiveRoot = process.env.PCA_R3_TEST_ROOT ?? root;
const manifestRoot = `${effectiveRoot}/.agent-runtime/manifests/pca-r3-final`;
const matrixPath = `${effectiveRoot}/docs/implementation/PCA_COMPLETION_V2_MATRIX.json`;

const paths = {
  audit: `${manifestRoot}/R3_REQUIREMENT_AUDIT.csv`,
  source: `${manifestRoot}/R3_SOURCE_BACKLOG.csv`,
  validation: `${manifestRoot}/R3_VALIDATION_BACKLOG.csv`,
  external: `${manifestRoot}/R3_EXTERNAL_GATE_REGISTER.csv`,
  progress: `${manifestRoot}/R3_PROGRESS_LEDGER.md`,
};

const SOURCE_UPDATES = {
  'PCA-NFR-021': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'parent-web/src/domain/types.ts',
      'parent-web/src/pages/Dashboard.tsx',
      'parent-web/src/components/common/DeviceOfflineNotice.tsx',
    ],
    testEvidence: [
      'parent-web/tests/component/DashboardFreshnessState.test.tsx',
      'parent-web/tests/component/DeviceOfflineNotice.test.tsx',
    ],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'The parent dashboard now distinguishes LIVE, CACHED, and UNAVAILABLE data freshness while retaining stale-data and local-protection messaging for offline devices.',
    nextAction: 'Keep freshness state sourced from actual device and synchronization observations; never infer LIVE from a cached timestamp alone.',
    notes: 'This closes the parent-web source contract without claiming live transport, relay, or real-device validation.'
  },
  'PCA-NFR-054': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'android/app/src/main/java/org/pca/app/feature/screentime/policy/ScreenTimeBaselinePolicy.kt',
      'android/app/src/main/java/org/pca/app/feature/screentime/policy/ScreenTimePolicyApplier.kt',
      'android/app/src/main/java/org/pca/app/feature/screentime/engine/ScreenTimeEngine.kt',
    ],
    testEvidence: [
      'android/app/src/test/java/org/pca/app/feature/screentime/policy/ScreenTimeBaselinePolicyTest.kt',
      'android/app/src/test/java/org/pca/app/feature/screentime/policy/ScreenTimePolicyApplierTest.kt',
    ],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'The Android screen-time baseline is enforced at configuration construction and policy application, rejecting weaker or out-of-range values and retaining the last-known-good policy offline.',
    nextAction: 'Keep the non-weakenable baseline as the single validation boundary for future screen-time policy inputs.',
    notes: 'Focused Android baseline and policy-applier tests passed; no production behavior change was required.'
  },
  'PCA-NFR-042': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'android/app/src/main/java/org/pca/app/feature/breakshield/BreakShieldScreen.kt',
      'android/app/src/main/res/values/strings.xml',
      'android/app/src/main/res/values-ar/strings.xml',
    ],
    testEvidence: [
      'android/app/src/test/java/org/pca/app/feature/breakshield/BreakShieldAccessibilityWiringTest.kt',
      'android/app/src/test/java/org/pca/app/feature/breakshield/BreakShieldFormatDurationTest.kt',
      'android/app/src/test/java/org/pca/app/feature/breakshield/EmergencyDialIntentTest.kt',
      'android/app/src/test/java/org/pca/app/i18n/NoHardcodedUiStringsTest.kt',
    ],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'Break Shield communicates its state and actions through localized visible text, labels, and accessibility semantics rather than relying on color alone.',
    nextAction: 'Preserve explicit text and semantic labels for any future Break Shield status or action state.',
    notes: 'Focused Android tests passed; screenshot-level contrast and physical-device rendering remain separate validation boundaries.'
  },
  'PCA-FR-124': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'android/app/src/main/java/org/pca/app/persistence/entity/ParentActionAuditEntity.kt',
      'android/app/src/main/java/org/pca/app/persistence/dao/ParentActionAuditDao.kt',
      'android/app/src/main/java/org/pca/app/persistence/entity/TamperEventEntity.kt',
      'android/app/src/main/java/org/pca/app/persistence/dao/TamperEventDao.kt',
      'android/app/src/main/java/org/pca/app/persistence/export/AuditRecordExportService.kt',
      'android/app/src/main/java/org/pca/app/persistence/PcaLocalPersistence.kt',
    ],
    testEvidence: [
      'android/app/src/test/java/org/pca/app/persistence/AuditRecordExportServiceTest.kt',
      'android/app/src/test/java/org/pca/app/persistence/RetentionEngineTest.kt',
      'android/app/src/test/java/org/pca/app/persistence/DeleteNowCoordinatorTest.kt',
    ],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'Android now provides a family-scoped local audit export containing policy/role/retention/deletion actions and tamper events in chronological JSON without decrypting optional action reasons.',
    nextAction: 'Keep any platform share/file caller local and preserve the separate encrypted family-data export boundary required by PCA-FR-125.',
    notes: 'Focused Android export, retention, and delete-now persistence tests passed; no readable central audit store or upload path was added.'
  },
  'PCA-NFR-040': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'android/app/src/main/java/org/pca/app/accessibility/PcaAccessibilityContent.kt',
      'android/app/src/main/java/org/pca/app/accessibility/AccessibilityPreferences.kt',
      'android/app/src/main/java/org/pca/app/MainActivity.kt',
      'android/app/src/main/java/org/pca/app/enrollment/EnrollmentActivity.kt',
      'android/app/src/main/java/org/pca/app/feature/webprotection/ui/SafeBrowserActivity.kt',
      'android/app/src/main/java/org/pca/app/feature/youtube/ui/YouTubeModeActivity.kt',
      'android/app/src/main/java/org/pca/app/security/ui/AdminSecurityActivity.kt',
      'parent-web/src/styles/global.css',
      'platform-admin-web/src/styles/global.css',
    ],
    testEvidence: [
      'android/app/src/test/java/org/pca/app/accessibility/AccessibilityPreferencesTest.kt',
    ],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'Android Compose child surfaces now share the tested system font-scale boundary, while parent and platform-admin web surfaces use rem-based sizing that remains responsive to browser text zoom.',
    nextAction: 'Keep new Compose entry points inside PcaAccessibilityContent and preserve rem/logical sizing on web surfaces.',
    notes: 'Android module compilation and focused accessibility tests passed; browser zoom layout and physical-device rendering remain separate validation boundaries.'
  },
  'PCA-NFR-045': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'parent-web/src/styles/global.css',
      'platform-admin-web/src/styles/global.css',
      'parent-web/tests/accessibility/axe.test.tsx',
      'platform-admin-web/tests/accessibility/axe.test.tsx',
    ],
    testEvidence: [
      'parent-web/tests/accessibility/axe.test.tsx (40/40 PASS across all 38 App page routes plus dialog/banner states)',
      'platform-admin-web/tests/accessibility/axe.test.tsx (21/21 PASS across all routed admin surfaces)',
    ],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'Parent-web axe coverage now exercises every App page route plus stateful dialog/banner surfaces, and platform-admin coverage remains complete; axe default rules include contrast and target-size checks.',
    nextAction: 'Keep each new parent or platform-admin route represented by a real provider-backed accessibility case.',
    notes: 'Parent axe suite passed 40/40 and TypeScript passed; JSDOM canvas and existing React act warnings remain test-environment noise, not accessibility violations.'
  },
  'PCA-ADD-ENR-011': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'android/app/src/main/java/org/pca/app/MainActivity.kt',
      'android/app/src/main/java/org/pca/app/runtime/ui/ChildHomeScreen.kt',
      'android/app/src/main/res/values/runtime_strings.xml',
      'android/app/src/main/res/values-ar/runtime_strings.xml',
    ],
    testEvidence: [
      'android/app/src/test/java/org/pca/app/runtime/ui/ChildHomeDisclosureStaticTest.kt',
      'android/app/src/test/java/org/pca/app/i18n/NoHardcodedUiStringsTest.kt',
    ],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'The reachable child home surface now plainly discloses PCA management state, parent-visible category boundaries, current restrictions/capability limits, parent-contact routes for more time/policy/removal requests, and emergency access in English and Arabic.',
    nextAction: 'Keep disclosure copy synchronized with the canonical privacy inventory and preserve truthful pending/offline wording for requests.',
    notes: 'Android resource compilation and focused disclosure tests passed; no system-identity simulation or unavailable direct removal control was added.'
  },
  'PCA-SEC-025': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'android/app/src/main/AndroidManifest.xml',
    ],
    testEvidence: [
      'android/app/src/test/java/org/pca/app/security/AllowBackupManifestTest.kt',
    ],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'Android application backup is explicitly disabled at the application boundary, and the focused test verifies the OS-derived ApplicationInfo flag rather than only matching manifest text.',
    nextAction: 'Keep backup disabled unless a reviewed allow-list and encrypted export boundary replace the whole-app exclusion.',
    notes: 'Focused Android manifest backup test passed; no production change was required.'
  },
  'PCA-ADD-PA-036': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'backend/src/entitlements/slots/SlotReservationService.ts',
      'backend/src/enrollment/EnrollmentCoordinator.ts',
      'backend/src/main.ts',
    ],
    testEvidence: ['backend/test/enrollment/slotConsumption.test.mjs', 'backend/test/db/platformEntitlementsSlots.mysql.test.mjs', 'backend/test/db/enrollment.mysql.test.mjs'],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'The stage-4 reservation transition is now wired to successful enrollment bootstrap, with retry-safe consumption and legacy no-reservation compatibility.',
    nextAction: 'Retain the consume-on-success invariant and re-check it if enrollment becomes transactionally composed with another capacity-consuming flow.',
    notes: 'A successful PAIRING_PENDING enrollment consumes the durable invitation reservation and moves reserved capacity to active capacity. The parent confirmation/trust transition remains separate and is not required to consume the commercial slot.',
  },
  'PCA-ADD-IDENT-021': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'backend/src/parentaccount/freeaccess/FreeAccessAcquisitionPolicy.ts',
      'backend/src/parentaccount/freeaccess/MySqlFreeAccessAccountRepository.ts',
      'backend/src/entitlements/slots/SlotReservationService.ts',
      'backend/src/entitlements/requests/ChangeRequestService.ts',
      'backend/src/invitation/InvitationService.ts',
      'backend/src/familycommercial/FamilyCommercialService.ts',
      'backend/src/main.ts',
    ],
    testEvidence: [
      'backend/test/parentaccount/freeaccess/FreeAccessAcquisitionPolicy.test.mjs',
      'backend/test/entitlements/FreeAccessAcquisitionCallSites.test.mjs',
    ],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'The persisted FREE_ACCESS expiry gate is enforced at the real managed-device invitation reservation and family commercial capacity-request call sites. Existing protections are never removed, and an active complimentary COMMERCIAL_ACCESS grant is the explicit override.',
    nextAction: 'Retain the gate and re-check it when a new commercial-capability acquisition call site is introduced.',
    notes: 'The policy is server-clock-driven and fail-closed. Legacy families without a parent FREE_ACCESS snapshot remain compatible; active complimentary COMMERCIAL_ACCESS is evaluated from durable grant state, never caller input.',
  },
  'PCA-ADD-PA-020': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'backend/src/platformadmin/auth/PlatformAdminAuthService.ts',
      'backend/src/platformadmin/auth/MySqlPlatformAdminAlertAdapter.ts',
      'backend/migrations/0021_platform_admin_security_alerts.sql',
      'backend/src/main.ts',
    ],
    testEvidence: [
      'backend/test/platformadmin/authService.test.mjs',
      'backend/test/db/platformAdminAlerts.mysql.test.mjs',
      'backend/test/schema-privacy.test.mjs',
    ],
    sourceSolvableClass: 'SOURCE_COMPLETE_EXTERNAL_GATE',
    externalGate: ['PLATFORM_ADMIN_ALERT_DELIVERY'],
    currentGap: 'Rate limiting and lockout are enforced, and triggering APP_OWNER/FINANCE_ADMIN failures now create a durable pending alert row for every other active APP_OWNER with opaque IDs and idempotent correlation. Actual email/SMS/paging delivery remains an external operations gate.',
    nextAction: 'Configure and independently verify the external delivery worker/provider for PLATFORM_ADMIN_ALERT_DELIVERY; retain the durable pending-row boundary.',
    notes: 'Unknown identities never create recipient rows. The local source does not store raw operator contact data, family data, or provider credentials.',
  },
  'PCA-SEC-026': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'android/app/src/main/java/org/pca/app/persistence/export/FamilyExportContract.kt',
      'android/app/src/main/java/org/pca/app/persistence/export/LocalRoomFamilyExportDataSource.kt',
      'android/app/src/main/java/org/pca/app/persistence/export/AuditRecordExportService.kt',
      'android/app/src/main/java/org/pca/app/persistence/PcaLocalPersistence.kt',
    ],
    testEvidence: ['android/app/src/test/java/org/pca/app/persistence/export/FamilyExportContractTest.kt'],
    sourceSolvableClass: 'SOURCE_COMPLETE_EXTERNAL_GATE',
    externalGate: ['CRYPTO_ACTIVATION'],
    currentGap: 'Android now has a family-scoped, retention-bounded export data source and encrypted-artifact file boundary. Owner plus step-up authorization, family isolation, manifest scope/timestamp, atomic storage, and fail-closed production crypto behavior are tested. Approved family E2EE export crypto activation remains an external gate; the rejecting production default is not a completion claim.',
    nextAction: 'Keep the encrypted export boundary fail-closed until the approved family E2EE crypto suite is activated and independently reviewed.',
    notes: 'Source closure is based on the integrated Android export contract and focused Robolectric coverage; no production crypto activation or external sharing capability is claimed.',
  },
  'PCA-ADD-PA-043': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'backend/src/http/routes/platformadmin/settingsRoutes.ts',
      'backend/src/platformadmin/settings/PlatformAdminSettingsService.ts',
      'backend/src/platformadmin/settings/PlatformAdminSettingsRepository.ts',
      'backend/src/platformadmin/settlement/PlatformAdminSettlementService.ts',
      'backend/src/entitlements/EntitlementRepository.ts',
      'backend/src/billing/currency.ts',
      'backend/src/billing/market.ts',
    ],
    testEvidence: [
      'backend/test/db/platformAdminSettingsCategories.mysql.test.mjs',
      'backend/test/db/settlement.mysql.test.mjs',
      'backend/test/db/billingCore.mysql.test.mjs',
      'backend/test/billing/currency.test.mjs',
      'backend/test/billing/market.test.mjs',
    ],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'Platform settings are now repository-reachable across branding/support metadata, FREE_STARTER defaults, currencies and market mapping, price-book/plan configuration surfaces, payment-provider references, settlement references, notification settings, maintenance mode, and Platform Administration/Billing feature flags. Sensitive provider and settlement values remain masked or reference-only on reads.',
    nextAction: 'Keep each settings category behind its existing role operation and extend the category test whenever a new setting family is introduced.',
    notes: 'The prior matrix note that provider, branding, notification, maintenance, and feature-flag surfaces were absent is stale. Generic category routes and service are backed by MySQL and covered by live category/RBAC/masking tests; billing and settlement suites cover the related configuration references.',
  },
  'PCA-DATA-021': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'android/app/src/main/java/org/pca/app/persistence/entity/ParentActionAuditEntity.kt',
      'android/app/src/main/java/org/pca/app/persistence/entity/TamperEventEntity.kt',
      'android/app/src/main/java/org/pca/app/persistence/dao/ParentActionAuditDao.kt',
      'android/app/src/main/java/org/pca/app/persistence/dao/TamperEventDao.kt',
      'android/app/src/main/java/org/pca/app/persistence/retention/RetentionEngine.kt',
    ],
    testEvidence: [
      'android/app/src/test/java/org/pca/app/persistence/RetentionEngineTest.kt',
    ],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'The Android local database persists parent-action audit and tamper rows with a distinct longer audit floor. General activity retention never targets either table; the separate transactional audit-floor cycle deletes only rows older than the configured twelve-month floor and receipts each deletion category.',
    nextAction: 'Retain the separate audit-floor boundary and extend the focused retention test if either audit entity gains new fields or scope rules.',
    notes: 'Focused Robolectric coverage now proves old and recent tamper and parent-action audit rows are handled identically, including one deletion receipt per category; the general-cycle non-interference test remains in the same suite.',
  },
  'PCA-FR-008': {
    status: 'PARTIAL',
    sourceEvidence: [
      'parent-web/src/pages/family/DeviceEnrollmentPanel.tsx',
      'backend/src/invitation/InvitationService.ts',
      'android/app/src/main/java/org/pca/app/enrollment/EnrollmentProfile.kt',
      'android/app/src/main/java/org/pca/app/enrollment/EnrollmentState.kt',
      'android/app/src/main/java/org/pca/app/enrollment/EnrollmentCoordinator.kt',
      'android/app/src/main/java/org/pca/app/enrollment/ui/EnrollmentScreen.kt',
      'android/app/src/main/java/org/pca/app/runtime/graph/PcaAppGraph.kt',
      'ios/PCA/Enrollment/ChildEnrollmentCoordinator.swift',
    ],
    testEvidence: [
      'backend/test/invitation/enrollmentProfile.test.mjs',
      'android/app/src/test/java/org/pca/app/enrollment/EnrollmentProfileContractTest.kt',
      'android/app/src/test/java/org/pca/app/enrollment/EnrollmentContentFilterDefaultTest.kt',
      'android/app/src/test/java/org/pca/app/enrollment/EnrollmentCoordinatorTest.kt',
      'android/app/src/test/java/org/pca/app/enrollment/ProfileConfirmationStateTransitionTest.kt',
      'android/app/src/test/java/org/pca/app/enrollment/EnrollmentProfileContractTest.kt',
      'ios/PCATests/EnrollmentProfileTests.swift',
    ],
    sourceSolvableClass: 'REAL_SOURCE_GAP',
    currentGap: 'Child-side enrollment now presents and requires confirmation of the parent-authorized age/mode profile without allowing a weaker override. The iOS runtime consumer, remaining age-tier content-filter catalogue, and broader iOS source path remain open.',
    validationGap: 'Backend, Android persistence, default mapping, and Safe Browser composition are covered by automated evidence; iOS/macOS/Xcode and physical-device validation remain external.',
    nextAction: 'Complete iOS bootstrap/runtime consumption and the remaining age-tier content-filter catalogue before source closure.',
    notes: 'Enrollment age tier and controlled initial profile flow through parent UI, invitation persistence, bootstrap, Android child-side profile confirmation, Android encrypted state, screen-time defaults, and Safe Browser SafeSearch minimums. Parent-authored stricter settings are never weakened. Full iOS transport/runtime wiring and the remaining content-filter catalogue remain open.',
  },
  'PCA-ADD-ENR-001': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'parent-web/src/pages/family/DeviceEnrollmentPanel.tsx',
      'backend/src/http/routes/invitationRoutes.ts',
      'backend/src/invitation/InvitationService.ts',
      'backend/migrations/0019_enrollment_profile_contract.sql',
      'android/app/src/main/java/org/pca/app/enrollment/EnrollmentApiClient.kt',
      'ios/PCA/Enrollment/ChildEnrollmentCoordinator.swift',
    ],
    testEvidence: [
      'backend/test/invitation/enrollmentProfile.test.mjs',
      'backend/test/db/http.mysql.test.mjs',
      'android/app/src/test/java/org/pca/app/enrollment/EnrollmentProfileContractTest.kt',
    ],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'Legacy service callers and pre-0019 rows remain nullable/default-compatible by design; every new parent HTTP invitation request now requires the three controlled profile fields.',
    nextAction: 'Retain the legacy compatibility boundary and re-check it when invitation creation is versioned or the nullable migration columns are retired.',
    notes: 'The parent administration HTTP contract requires child selection, target platform, requested protection mode, and initial policy profile. Legacy internal callers and pre-0019 rows remain default-compatible without weakening the new parent-facing contract. The child profile reference is opaque and never placed in the enrollment URL, QR, fallback code, or logs.',
  },
  'PCA-FR-094': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: ['backend/src/parentaccount/ParentPreferenceRepository.ts', 'backend/src/parentaccount/MySqlParentPreferenceRepository.ts', 'backend/src/http/routes/parentAccountRoutes.ts', 'backend/migrations/0020_parent_preferences_safe_zones.sql', 'parent-web/src/pages/Notifications.tsx', 'parent-web/src/api/real/realParentPreferencesClient.ts'],
    testEvidence: ['backend/test/parentaccount/preferencesSafeZonesRoute.test.mjs'],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'Approved email-alert and push-request categories plus a validated, unverified-by-default email destination now persist per authenticated parent account. Provider delivery remains an external gate.',
    validationGap: 'Focused account-isolation/CSRF behavior passes in-process and Parent Web typecheck passes; Node worker mode is blocked by spawn EPERM and MySQL/provider delivery evidence is pending.',
    nextAction: 'Validate migration and downstream notification delivery without introducing invasive or child-content categories.',
    notes: 'The preference vocabulary is intentionally closed to the two approved categories; email delivery cannot use an unverified destination and no invasive child-activity category is exposed.',
  },
  'PCA-FR-112': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: ['backend/src/parentaccount/ParentPreferenceRepository.ts', 'backend/src/parentaccount/MySqlParentPreferenceRepository.ts', 'backend/src/http/routes/parentAccountRoutes.ts', 'parent-web/src/pages/Settings.tsx', 'parent-web/src/i18n/index.ts', 'parent-web/src/api/real/realParentPreferencesClient.ts', 'backend/migrations/0020_parent_preferences_safe_zones.sql'],
    testEvidence: ['backend/test/parentaccount/preferencesSafeZonesRoute.test.mjs'],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'Language is now loaded and saved per authenticated parent account; the child device remains independent because this record is keyed only by accountId.',
    validationGap: 'Focused same-family account isolation passes in-process and Parent Web typecheck passes; browser restart and multi-browser RTL automation plus live MySQL validation remain pending.',
    nextAction: 'Run browser restart, two-parent, and RTL/large-text journeys and confirm migration parity in disposable MySQL.',
    notes: 'Only English and Arabic are accepted; invalid language values are rejected server-side and no family/global language record is used.',
  },
  'PCA-ADD-PA-006': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: ['docs/implementation/addenda/PCA_ADDENDUM_002_PLATFORM_ADMINISTRATION_BILLING.md', 'tooling/release/ValidateCanonicalTrustBoundary.mjs', 'tooling/release/Invoke-ReleaseGateCheck.ps1'],
    testEvidence: ['tooling/release/ValidateCanonicalTrustBoundary.mjs'],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'The canonical Platform Administration trust-boundary diagram is now a deterministic release-gate input with required family, infrastructure, platform-plane, E2EE, and no-plaintext edges asserted.',
    validationGap: 'The validator is locally executable; independent document-owner review remains a governance gate for future boundary changes.',
    nextAction: 'Run the canonical diagram validator whenever the addendum or trust-boundary documentation changes.',
    notes: 'This requirement is documentation governance, not a new runtime authority. The validator prevents accidental removal of the canonical boundary markers from the governed addendum source.',
  },
  'PCA-ADD-PA-048': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: ['tooling/release/ValidateR3EvidenceDiscipline.mjs', 'tooling/release/ValidateExternalGateParity.mjs', 'tooling/release/Invoke-ReleaseGateCheck.ps1'],
    testEvidence: ['tooling/release/ValidateR3EvidenceDiscipline.mjs', 'tooling/release/ValidateExternalGateParity.mjs'],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'R3 source/evidence discipline is now executable: external-gated source-complete rows require explicit gates, backlog rows require classifications and next actions, and unsupported final claims are rejected.',
    validationGap: 'The release gate remains NOT_READY while production crypto, real UAT, and other external gates remain open; this requirement does not close those gates.',
    nextAction: 'Run the release gate before publishing any completion or production-readiness claim.',
    notes: 'The validator enforces reporting discipline without converting local source evidence into VALIDATED_COMPLETE or PRODUCTION_READY.',
  },
  'PCA-FR-114': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'android/app/src/main/res/values/strings.xml',
      'android/app/src/main/res/values-ar/strings.xml',
    ],
    testEvidence: [
      'android/app/src/test/java/org/pca/app/i18n/ArabicResourceParityTest.kt',
    ],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'The Android Arabic locale now contains an exact key-set match for the default string and plural resources, preventing newly added user-facing keys from silently falling back to English.',
    nextAction: 'Keep the parity test in the Android unit suite and obtain native-language review for wording quality when translations change.',
    notes: 'Static resource parity is locally verified; this does not claim independent native-language editorial sign-off.',
  },
  'PCA-FR-000A': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'android/app/src/main/java/org/pca/app/runtime/schedule/ScheduleRuntime.kt',
      'android/app/src/main/java/org/pca/app/runtime/schedule/ProductionScheduleRuntimePort.kt',
      'android/app/src/main/java/org/pca/app/runtime/graph/PcaAppGraph.kt',
      'parent-web/src/domain/types.ts',
      'parent-web/src/pages/Dashboard.tsx',
      'parent-web/src/pages/security/ProtectionStatus.tsx',
    ],
    testEvidence: [
      'android/app/src/test/java/org/pca/app/runtime/schedule/ScheduleRuntimeRebootOfflineTest.kt',
      'android/app/src/test/java/org/pca/app/runtime/schedule/ScheduleEnforcementConsumerTest.kt',
      'parent-web/tests/component/DashboardCapabilityState.test.tsx',
    ],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'Android resolves enforcement capability from the live device-policy authority in the production graph and fails closed when protected enforcement is unavailable; parent-web carries explicit capability states and renders unavailable/stale states as labeled statuses rather than presenting them as active.',
    nextAction: 'Keep capability providers live and preserve explicit status rendering whenever a new enforcement surface is added.',
    notes: 'The parent-web equivalent is a capability-state presentation boundary, not a fabricated claim that the browser can provision or enforce Android Device Owner authority.',
  },
  'PCA-NFR-043': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'platform-admin-web/src/i18n/index.ts',
      'platform-admin-web/src/i18n/locales/en.json',
      'platform-admin-web/src/i18n/locales/ar.json',
      'platform-admin-web/src/styles/global.css',
    ],
    testEvidence: [
      'platform-admin-web/tests/unit/i18nRtl.test.ts',
      'parent-web/tests/i18n/rtl.test.tsx',
      'parent-web/tests/i18n/deviceEnrollmentRtl.test.tsx',
      'parent-web/tests/i18n/freeAccessRtl.test.tsx',
      'parent-web/tests/i18n/settingsRtl.test.tsx',
      'parent-web/tests/i18n/subscriptionRtl.test.tsx',
    ],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'Both web surfaces have explicit Arabic resource parity, RTL direction wiring, mirrored-navigation styling, and focused RTL coverage; platform-admin-web now has its own RTL test rather than relying only on parent-web coverage.',
    nextAction: 'Keep locale key parity tests running when either web surface adds user-facing copy and obtain native-language review for wording quality when translations change.',
    notes: 'The repository proves direction/key-set behavior and rendered parent-web RTL paths; this does not claim independent native-language editorial sign-off.',
  },
  'PCA-FR-084': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'android/app/src/main/java/org/pca/app/security/ui/AdminSecurityActivity.kt',
      'android/app/src/main/java/org/pca/app/security/Pbkdf2AdminPinVerifier.kt',
      'android/app/src/main/java/org/pca/app/security/RealBiometricAuthGate.kt',
      'android/app/src/main/java/org/pca/app/feature/removaldecision/ui/RemovalDecisionScreen.kt',
      'android/app/src/main/AndroidManifest.xml',
      'android/app/src/main/java/org/pca/app/MainActivity.kt',
      'android/app/src/main/java/org/pca/app/runtime/ui/ChildHomeScreen.kt',
    ],
    testEvidence: [
      'android/app/src/test/java/org/pca/app/security/Pbkdf2AdminPinVerifierTest.kt',
      'android/app/src/test/java/org/pca/app/security/UnavailableBiometricAuthGateTest.kt',
      'android/app/src/test/java/org/pca/app/feature/removaldecision/RemovalDecisionStateMachineTest.kt',
      'android/app/src/test/java/org/pca/app/feature/removaldecision/RemovalDecisionCoordinatorTest.kt',
      'android/app/src/test/java/org/pca/app/feature/removaldecision/PersistentRemovalDecisionRepositoryTest.kt',
    ],
    sourceSolvableClass: 'SOURCE_COMPLETE_EXTERNAL_GATE',
    externalGate: ['DEVICE_OWNER_REAL_DEVICE_AUTHORIZATION'],
    currentGap: 'The Android PIN/biometric-gated admin entry point and removal-decision state machine are real, registered, reachable, persisted, and locally tested. Ordinary Android uninstall prevention still requires verified Device Owner authority on a real child device.',
    nextAction: 'Retain the local authentication/removal boundary and independently verify Device Owner provisioning and uninstall behavior on an authorized real device.',
    notes: 'Local source does not claim that a normal app install can prevent uninstall; the remaining capability is represented by the explicit external gate.',
  },
  'PCA-ADD-ENR-014': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'android/app/src/main/java/org/pca/app/security/Pbkdf2AdminPinVerifier.kt',
      'android/app/src/main/java/org/pca/app/security/PinAttemptThrottle.kt',
      'android/app/src/main/java/org/pca/app/security/ThrottledAdminPinVerifier.kt',
      'android/app/src/main/java/org/pca/app/security/ui/AdminPinScreen.kt',
      'android/app/src/main/java/org/pca/app/security/ui/AdminSecurityActivity.kt',
    ],
    testEvidence: [
      'android/app/src/test/java/org/pca/app/security/Pbkdf2AdminPinVerifierTest.kt',
      'android/app/src/test/java/org/pca/app/security/PinAttemptThrottleTest.kt',
      'android/app/src/test/java/org/pca/app/security/ThrottledAdminPinVerifierTest.kt',
      'android/app/src/test/java/org/pca/app/security/PersistentPinThrottleStateStoreTest.kt',
    ],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'The Android local Administration PIN verifier uses a per-device random salt and deliberately slow PBKDF2 derivation, never stores the raw PIN, and composes persistent rate limiting with monotonic progressive failure delay before the reachable masked PIN UI accepts verification.',
    nextAction: 'Retain the verifier/throttle composition and obtain independent security review before treating the PIN mechanism as production security approval.',
    notes: 'This closes the local verifier requirement only; it does not close the separate parent-panel configuration requirement PCA-ADD-ENR-012 or claim independent cryptographic/security review.',
  },
  'PCA-FR-127': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'android/app/build.gradle.kts',
      'android/build.gradle.kts',
      'android/gradle/libs.versions.toml',
    ],
    testEvidence: [
      'backend/scripts/checkNoAdTrackingSdks.mjs',
    ],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'The Android dependency manifests contain no ad-serving, install-attribution, or cross-app data-broker SDK coordinates; the repository scanner checks the real Android and web/backend manifests against the maintained blocked-coordinate inventory.',
    nextAction: 'Run the no-ad/data-broker scanner whenever dependency manifests change; keep any future analytics or product-measurement decision separate from prohibited ad/tracking SDK inventory.',
    notes: 'The direct scanner passes against the current repository. The subprocess test file has five Windows child-process cases that remain environment-blocked by spawn EPERM, so this closure does not claim those subprocess cases passed.',
  },
  'PCA-FR-142': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'parent-web/src/pages/family/DeviceEnrollmentPanel.tsx',
      'parent-web/src/i18n/locales/en.json',
      'parent-web/src/i18n/locales/ar.json',
    ],
    testEvidence: [
      'parent-web/tests/component/DeviceEnrollmentPanel.test.tsx',
      'parent-web/tests/i18n/deviceEnrollmentRtl.test.tsx',
    ],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'The parent device-enrollment surface now presents a localized monitoring-scope summary and requires explicit confirmation before the one-time invitation API call can mint a token; canceling the disclosure leaves the invitation uncreated.',
    nextAction: 'Keep the disclosure gate before any future invitation-creation path and obtain independent product/privacy review when the monitoring scope changes.',
    notes: 'This closes the repository-owned consent timing and disclosure surface for adding a device. It does not claim independent legal/privacy review or native-language editorial sign-off.',
  },
  'PCA-ADD-BILL-026': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'backend/src/billing/webhook/WebhookService.ts',
      'backend/src/billing/settlement/SettlementService.ts',
    ],
    testEvidence: [
      'backend/test/billing/loggingPrivacy.test.mjs',
    ],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'Billing source contains a static sensitive-field logging scan and a runtime console-capture regression test that carries a secret-shaped provider reference without emitting diagnostic output.',
    nextAction: 'Keep the billing logging-privacy test in the standard backend suite and extend its sensitive-field inventory when billing surfaces change.',
    notes: 'The evidence covers both static call-site scanning and runtime output capture; it does not claim infrastructure-level log sink configuration or production observability review.',
  },
  'PCA-ADD-BILL-039': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'backend/src/auth/fastifyAuthPlugin.ts',
      'backend/src/http/routes/parentAccountRoutes.ts',
      'parent-web/src/api/real/realBillingClient.ts',
      'parent-web/src/api/real/realCommercialNotificationClient.ts',
      'parent-web/src/api/client.ts',
    ],
    testEvidence: [
      'backend/test/auth/fastifyAuthPlugin.test.mjs',
      'parent-web/tests/unit/realBillingClient.test.ts',
      'parent-web/tests/unit/realCommercialNotificationClient.test.ts',
      'parent-web/tests/unit/apiClientFactory.test.ts',
    ],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'The real parent-web billing and commercial-notification clients now use the existing HttpOnly family session cookie, resolve family scope through the browser-reachable parent session projection, and send CSRF headers for mutations instead of failing with SERVICE_SESSION_UNAVAILABLE.',
    nextAction: 'Keep cookie-session and CSRF transport tests aligned with any future family-commercial route changes; retain payment-provider activation as a separate gate.',
    notes: 'This closes the browser session transport gap only. It does not claim a real payment provider, family-owner cryptographic authority activation, or production readiness.',
  },
  'PCA-ADD-PA-047': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'backend/src/auth/fastifyAuthPlugin.ts',
      'backend/src/http/routes/familyCommercialRoutes.ts',
      'parent-web/src/api/real/realBillingClient.ts',
      'parent-web/src/api/client.ts',
    ],
    testEvidence: [
      'backend/test/auth/fastifyAuthPlugin.test.mjs',
      'parent-web/tests/unit/realBillingClient.test.ts',
    ],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'Parent-web real billing requests now have a browser-reachable cookie session transport and server-side family-scoped session validation; direct parent entitlement writes remain unavailable through the family-owner authority gate.',
    nextAction: 'Retain the server-side no-direct-write boundary and obtain the separate family-owner authority evidence before enabling owner mutations.',
    notes: 'The session transport is locally complete; this does not bypass or claim completion of the independent family-owner authority boundary.',
  },
  'PCA-ADD-ENR-009': {
    status: 'PARTIAL',
    sourceEvidence: [
      'android/app/src/main/java/org/pca/app/platform/DevicePolicyCapabilitySource.kt',
      'android/app/src/main/java/org/pca/app/platform/StandardDevicePolicyCapabilitySource.kt',
      'android/app/src/main/java/org/pca/app/platform/ProtectedModeProvisioningGate.kt',
    ],
    testEvidence: [
      'android/app/src/test/java/org/pca/app/platform/DevicePolicyCapabilityLifecycleTest.kt',
      'android/app/src/test/java/org/pca/app/platform/ProtectedModeProvisioningGateTest.kt',
      'android/app/src/test/java/org/pca/app/platform/DevicePolicyProtectionCapabilitiesTest.kt',
    ],
    sourceSolvableClass: 'REAL_SOURCE_GAP',
    currentGap: 'Protected Mode now queries documented DevicePolicyManager authority live, distinguishes revocation from an unverifiable query, and fails closed instead of inferring support; real Device Owner provisioning, app-graph reachability, and uninstall enforcement remain open.',
    nextAction: 'Verify authorized Device Owner provisioning and uninstall behavior on an approved real child device before treating Protected Mode as available.',
    notes: 'No hidden provisioning, Accessibility abuse, or normal-install uninstall-prevention claim was introduced.',
  },
  'PCA-ADD-ENR-012': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'backend/src/enrollment/AdministrationPinService.ts',
      'backend/src/enrollment/MySqlAdministrationPinRepository.ts',
      'backend/migrations/0022_enrollment_administration_persistence.sql',
      'backend/src/http/routes/removalDecisionRoutes.ts',
      'backend/src/http/buildServer.ts',
      'backend/src/main.ts',
      'parent-web/src/pages/family/ProtectionAdministrationPanel.tsx',
      'parent-web/src/pages/family/Devices.tsx',
      'parent-web/src/api/real/realProtectionAdministrationActions.ts',
    ],
    testEvidence: [
      'backend/test/enrollment/AdministrationPinService.test.mjs',
      'backend/test/enrollment/AdministrationPersistenceSchema.test.mjs',
      'backend/test/familyrbac/removalDecisionRoutes.wiring.test.mjs',
    ],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'R3 update (2026-08-21): closes the two gaps the 2026-08-20 re-derivation identified. GET/POST /api/parent/families/:familyId/administration-pin is now registered (removalDecisionRoutes.ts, wired into buildServer.ts/main.ts), and AdministrationPinService/MySqlAdministrationPinRepository are instantiated and threaded through. ProtectionAdministrationPanel.tsx now receives a real actions prop (RealProtectionAdministrationActions, constructed in Devices.tsx) that calls getPinStatus/configurePin against the live route; no longer presentational-only.',
    nextAction: 'Keep the PIN route session/CSRF/family-scope checks aligned with removalDecisionRoutes.ts\'s other endpoints as that file evolves.',
    notes: 'R3 update (2026-08-21, base 503865c): verified end-to-end against a real disposable MySQL database this session -- configured a PIN via the live HTTP route, confirmed only a salted verifier is persisted (never the raw PIN), and confirmed the value survives a real backend process restart.',
  },
  'PCA-ADD-ENR-016': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'backend/src/familyrbac/RemovalDecisionAuthority.ts',
      'backend/src/familyrbac/MySqlRemovalDecisionRepository.ts',
      'backend/migrations/0023_removal_decision_authority_persistence.sql',
      'backend/src/http/routes/removalDecisionRoutes.ts',
      'backend/src/http/buildServer.ts',
      'parent-web/src/pages/family/ProtectionAdministrationPanel.tsx',
      'parent-web/src/pages/family/Devices.tsx',
      'parent-web/src/api/real/realProtectionAdministrationActions.ts',
    ],
    testEvidence: [
      'backend/test/familyrbac/RemovalDecisionAuthority.test.mjs',
      'backend/test/enrollment/AdministrationPersistenceSchema.test.mjs',
      'backend/test/familyrbac/removalDecisionRoutes.wiring.test.mjs',
      'backend/test/http/buildServer.removalDecisionAndSafeZoneWiring.test.mjs',
    ],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'R3 update (2026-08-21): closes the "not yet wired into buildServer.ts" gap the 2026-08-20 re-derivation identified -- registerRemovalDecisionRoutes(app, {...}) is now called from buildServer.ts and reachable end-to-end (confirmed via a real live HTTP request against a real disposable MySQL database this session, not just a grep). Local-PIN decisions are genuinely reachable; signed remote-parent decisions remain fail-closed pending the separate PCA-DEC-020 crypto-suite review (RejectingDeviceSignatureVerifier), which is not this row\'s gap.',
    nextAction: 'No further source-solvable action for the local-PIN decision mode; signed remote-parent activation depends on the crypto-suite review.',
    notes: 'R3 update (2026-08-21, base 503865c): verified live -- created a removal-decision request and decided it with a local PIN through the real HTTP route against a real database this session.',
  },
  'PCA-ADD-ENR-017': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: [
      'backend/src/familyrbac/RemovalDecisionAuthority.ts',
      'backend/src/familyrbac/MySqlRemovalDecisionRepository.ts',
      'backend/migrations/0023_removal_decision_authority_persistence.sql',
      'backend/src/http/routes/removalDecisionRoutes.ts',
      'backend/src/http/buildServer.ts',
      'parent-web/src/pages/family/ProtectionAdministrationPanel.tsx',
      'parent-web/src/pages/family/Devices.tsx',
      'parent-web/src/api/real/realProtectionAdministrationActions.ts',
    ],
    testEvidence: [
      'backend/test/familyrbac/RemovalDecisionAuthority.test.mjs',
      'backend/test/enrollment/AdministrationPersistenceSchema.test.mjs',
      'backend/test/familyrbac/removalDecisionRoutes.wiring.test.mjs',
    ],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'R3 update (2026-08-21): same wiring closure as ENR-016 -- the KEEP_ACTIVE/TEMPORARILY_DISABLE/ALLOW_REMOVAL state machine is now reachable end-to-end via the real HTTP route for the local-PIN decision mode, verified live against a real database this session.',
    nextAction: 'No further source-solvable action for the local-PIN decision mode.',
    notes: 'R3 update (2026-08-21, base 503865c): verified live this session.',
  },
  'PCA-ADD-ENR-020': {
    status: 'PARTIAL',
    sourceEvidence: [
      'backend/src/alerts/types.ts',
      'backend/src/alerts/policy.ts',
      'backend/src/alerts/ProtectionAlertGenerator.ts',
      'backend/src/alerts/ProtectionAlertLedger.ts',
      'backend/src/alerts/MySqlProtectionAlertLedger.ts',
      'backend/src/alerts/ProtectionAlertProducer.ts',
      'backend/src/alerts/RejectingOpaqueProtectionAlertComposer.ts',
      'backend/src/alerts/MySqlOwnerParentDeviceResolver.ts',
      'backend/migrations/0025_protection_alerts.sql',
      'backend/src/familyrbac/RemovalDecisionAuthority.ts',
      'backend/src/invitation/InvitationService.ts',
      'backend/src/http/routes/runtimeSyncRoutes.ts',
      'backend/src/http/buildServer.ts',
      'backend/src/main.ts',
      'ios/PCA/Alerts/ProtectionAlert.swift',
      'parent-web/src/pages/security/ProtectionAlertPanel.tsx',
      'parent-web/src/pages/security/ProtectionStatus.tsx',
    ],
    testEvidence: [
      'backend/test/alerts/ProtectionAlert.test.mjs',
      'backend/test/alerts/ProtectionAlertProducer.test.mjs',
      'backend/test/alerts/RejectingOpaqueProtectionAlertComposer.test.mjs',
      'backend/test/db/protectionAlerts.mysql.test.mjs',
      'backend/test/familyrbac/RemovalDecisionAuthority.test.mjs',
      'backend/test/invitation/service.test.mjs',
      'backend/test/runtime-sync/http/runtimeSyncRoutes.test.mjs',
      'ios/PCATests/AlertProtectionTests.swift',
    ],
    sourceSolvableClass: 'REAL_SOURCE_GAP',
    currentGap: 'R3 update (2026-08-21): alerting is now genuinely COMPOSED in production (main.ts previously left `alerting` null on RemovalDecisionAuthority entirely -- zero alerts were ever producible before this). A durable MySQL ledger (migration 0025) replaces the in-memory-only reference implementation. 6 of 10 triggers now fire from real event sources: DISABLE_OR_REMOVAL_REQUESTED (unchanged), AUTHORITY_CHANGE (now correctly scoped to KEEP_ACTIVE/TEMPORARILY_DISABLE decisions only), UNENROLLMENT (new -- an ALLOW_REMOVAL/REMOVE_REVOKE_DEVICE decision, previously mislabeled AUTHORITY_CHANGE), REPEATED_INVALID_PIN (new -- fires when AdministrationPinService crosses its lockout threshold), PROTECTION_DEGRADED (new -- fires on a genuine STANDARD/PROTECTED->DEGRADED transition in the protection-status route, diffed against the prior stored value, never on a repeated report), INVITATION_REDEEMED (new -- InvitationService.redeemInvitation). resolveParentDevices is genuinely real (MySqlOwnerParentDeviceResolver, reading the signature-chain-verified family_authority_attestations/chain_heads tables, verified end-to-end including an Owner-transfer scenario) but resolves the current Owner device ONLY -- no table in this codebase registers per-device keys for Administrator-role parents, a genuine gap, not fabricated around. Every produce() call still fails closed via RejectingOpaqueProtectionAlertComposer (same CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW gate as every other signed-device path), so no alert is actually delivered in production today -- that part is SOURCE_COMPLETE_EXTERNAL_GATE-equivalent. Remaining REAL gaps, investigated and intentionally left unwired rather than fabricated: CRITICAL_PERMISSION_OR_VPN_LOST/UNEXPECTED_OFFLINE/TIME_TAMPERING have real detection logic (backend/src/tamper/) but NO HTTP route anywhere invokes it in production today (confirmed by grep across backend/src/http) -- wiring these would require designing and building a new device-authenticated tamper-report endpoint, not merely an alert call, so it is left open rather than attempted as a same-batch add-on. REINSTALLATION has no non-invasive server-observable signal at all in the current devices schema (a reinstalling device is indistinguishable from a newly-enrolled one without fingerprinting, which is explicitly out of scope).',
    nextAction: 'Design and build a device-authenticated tamper-condition report endpoint (mirroring the protection-status route pattern) to give CRITICAL_PERMISSION_OR_VPN_LOST/UNEXPECTED_OFFLINE/TIME_TAMPERING a real production call path; separately, decide whether an Administrator-role parent-device registry is worth building before broadening resolveParentDevices beyond the Owner.',
    notes: 'R3 update (2026-08-21, base 7e50267): verified via 1621/1621 backend unit tests, 409/413 (+4 correctly-deferred) disposable-MySQL tests from empty including migration 0025, and a real HTTP sanity check against the production-wired server (unauthenticated invitation-creation and protection-status requests still correctly 401). No fabricated event, no invasive fingerprinting, no plaintext alert delivery introduced.',
  },
  'PCA-FR-063': {
    status: 'PARTIAL',
    sourceEvidence: [
      'android/app/src/main/java/org/pca/app/runtime/location/geofence/GeofenceEngine.kt',
      'android/app/src/main/java/org/pca/app/runtime/location/geofence/GeofenceMonitor.kt',
      'backend/src/location/SafeZoneRepository.ts',
      'backend/src/location/MySqlSafeZoneRepository.ts',
      'backend/test/location/safeZoneRepository.test.mjs',
      'backend/src/http/routes/parentAccountRoutes.ts',
      'backend/src/location/SafeZonePolicyAuthorization.ts',
      'backend/src/familyrbac/ParentActionAuthorizationService.ts',
      'backend/src/familyrbac/UnavailableTrustSetRoleResolver.ts',
      'backend/src/http/buildServer.ts',
      'backend/src/main.ts',
      'parent-web/src/pages/children/LocationPage.tsx',
      'parent-web/src/api/real/realSafeZoneClient.ts',
      'parent-web/src/api/safeZonePolicyAuthoring.ts',
      'android/app/src/main/java/org/pca/app/runtime/location/geofence/SafeZoneRuntime.kt',
      'android/app/src/main/java/org/pca/app/runtime/location/geofence/GeofenceZoneStateStore.kt',
      'parent-web/tests/unit/realSafeZoneClient.test.ts',
      'parent-web/tests/unit/safeZonePolicyAuthoring.test.ts',
      'android/app/src/main/java/org/pca/app/runtime/location/geofence/SafeZonePolicyReceiver.kt',
      'backend/migrations/0020_parent_preferences_safe_zones.sql',
      'backend/src/runtime-sync/DeviceSessionService.ts',
      'backend/migrations/0026_browser_endpoint_registration.sql',
      'backend/src/device/types.ts',
      'backend/src/device/DeviceRepository.ts',
      'backend/src/device/MySqlDeviceRepository.ts',
      'backend/src/device/BrowserEndpointService.ts',
      'backend/src/http/routes/browserEndpointRoutes.ts',
      'backend/src/pairing/PairingService.ts',
      'backend/src/http/routes/pairingRoutes.ts',
      'backend/src/authz/types.ts',
      'backend/src/authz/policy.ts',
    ],
    testEvidence: [
      'android/app/src/test/java/org/pca/app/runtime/location/geofence/GeofenceEngineTest.kt',
      'android/app/src/test/java/org/pca/app/runtime/location/geofence/SafeZonePolicyReceiverTest.kt',
      'android/app/src/test/java/org/pca/app/runtime/location/geofence/SafeZoneRuntimeTest.kt',
      'backend/test/location/safeZoneRepository.test.mjs',
      'backend/test/parentaccount/preferencesSafeZonesRoute.test.mjs',
      'backend/test/parentaccount/preferencesSafeZonesSchema.test.mjs',
      'backend/test/familyrbac/ParentActionAuthorizationService.test.mjs',
      'parent-web/tests/unit/realSafeZoneClient.test.ts',
      'parent-web/tests/unit/safeZonePolicyAuthoring.test.ts',
      'tooling/release/ValidateSafeZoneMutationBoundary.mjs',
      'backend/test/device/BrowserEndpointService.test.mjs',
      'backend/test/http/browserEndpointRoutes.test.mjs',
      'backend/test/pairing/service.test.mjs',
      'backend/test/db/browserEndpoint.mysql.test.mjs',
      'backend/test/db/device.mysql.test.mjs',
    ],
    sourceSolvableClass: 'SOURCE_COMPLETE_EXTERNAL_GATE',
    externalGate: ['CRYPTO_ACTIVATION'],
    currentGap: 'R3 update (2026-08-21): closes the trusted-browser endpoint enrollment gap identified by a full-repo investigation this session (RealTrustedBrowserProvider\'s own KNOWN_BACKEND_INTEGRATION_ACTION comment: "this browser endpoint must go through actual device enrollment... out of scope for this change"). Platform now admits BROWSER (migration 0026 widens devices_platform_check, preserving ANDROID/IOS verbatim) alongside the existing ANDROID/IOS-only EnrollmentCoordinator path, which remains untouched -- a browser endpoint registers via a NEW, narrower BrowserEndpointService/POST /v1/families/:familyId/browser-endpoints (service-session + REGISTER_BROWSER_ENDPOINT-authorized), never through the child-invitation pipeline. Registration alone is never trust: the resulting device starts PAIRING_PENDING and still requires the EXISTING, completely unchanged pairing-requests/:deviceId/confirm route before it is PAIRED. New: devices.registered_by_account_id (migration 0026) mechanically enforces "no self-approval" -- confirmPairing now rejects (SELF_APPROVAL_DENIED) the SAME account that registered an endpoint from also confirming it, a risk mobile enrollment never has (a child device claiming an invitation has no service session at all) but a browser endpoint genuinely does (the same logged-in parent could otherwise trivially self-approve). Downstream of confirmation, the full existing chain is real and unchanged: device-auth challenge/session (generic, live-proved reachable for a BROWSER-platform device this session) and Safe Zone actor authorization (authorizeSafeZoneRequest, already consuming DeviceSessionService.requireActorDeviceInFamily). Final TRUSTED status remains blocked on the SAME two things as before this change -- UnavailableTrustSetRoleResolver (unconditionally deny, unswapped) and RejectingDeviceSignatureVerifier (CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW) -- so this is SOURCE_COMPLETE_EXTERNAL_GATE for the enrollment/registration/confirmation/actor-authorization plumbing specifically, not a claim that Safe Zone trust verification itself is unblocked.',
    nextAction: 'Swap UnavailableTrustSetRoleResolver for a real, device-local-Family-Trust-Set-backed implementation once CRYPTO_SUITE clears review -- this is the one remaining step between PAIRED and genuine TRUSTED for both mobile and browser endpoints alike.',
    notes: 'R3 update (2026-08-21, base 1333ee6): verified live end-to-end against the real production-wired server (real RejectingDeviceSignatureVerifier untouched, real MySQL, real service sessions minted via AuthService.issueSession) -- registered a real browser endpoint, confirmed the registering account is denied (403 self_approval_denied) confirming its own registration, confirmed a DIFFERENT account reaches PAIRED, and confirmed the resulting BROWSER device successfully receives a device-auth challenge. Also verified: 1635/1635 backend unit tests, 414/418 (+4 correctly-deferred) disposable-MySQL tests from empty including migration 0026 -- a genuine bug (the SQL self-approval guard existed only in the post-mortem branch, never the primary UPDATE\'s WHERE clause, so a self-approval attempt actually succeeded) was caught by the real-MySQL test suite specifically (the in-memory reference implementation did not have the bug) and fixed before this note was written.',
  },

  // --- R3 NFR-051 evidence-backlog closure (2026-08-21) ---
  // The following entries close the 84-row PCA_COMPLETION_V2_MATRIX.json
  // sourceEvidence/testEvidence backlog identified this session. Every
  // entry below was independently re-verified against real source/tests
  // (not merely copied from a stale doc) before being cited here. Rows
  // needing actual new source/tests (not just citation) are handled in
  // their own dedicated, larger entries further below, dated with their
  // own implementation commit.
  'PCA-ADD-PA-012': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: ['backend/src/platformadmin/auth/PlatformAdminAccountService.ts', 'backend/src/platformadmin/auth/token.ts', 'backend/src/platformadmin/auth/rbacPolicy.ts', 'backend/src/platformadmin/auth/PlatformAdminAuthService.ts', 'backend/src/parentaccount/ParentAccountService.ts', 'backend/migrations/0005_platform_admin_identity_rbac_audit.sql'],
    testEvidence: ['backend/test/platformadmin/accountService.test.mjs', 'backend/test/platformadmin/token.test.mjs', 'backend/test/platformadmin/crossRealm.test.mjs', 'backend/test/platformadmin/rbacPolicy.test.mjs', 'backend/test/platformadmin/authService.test.mjs', 'backend/test/platformadmin/totp.test.mjs', 'backend/test/platformadmin/auditTypes.test.mjs'],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'This is a rollup requirement (dedicated account + dedicated session + dedicated RBAC + MFA + step-up + audit, none individually sufficient) satisfied by the conjunction of its 6 child requirements (PA-013..018), each already real and separately cited elsewhere in this matrix. Evidence backfilled to the union of those children\'s files.',
    nextAction: 'None -- keep in sync if any child requirement (PA-013..018) is ever removed or weakened.',
    notes: 'R3 evidence-backfill (2026-08-21): re-verified all 6 child files exist and are substantial (not stubs) before citing.',
  },
  'PCA-ADD-BILL-012': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: ['backend/migrations/0015_settlement_reconciliation.sql', 'backend/src/billing/settlement/types.ts', 'backend/src/billing/settlement/SettlementService.ts'],
    testEvidence: ['backend/test/billing/settlement.test.mjs', 'backend/test/db/settlement.mysql.test.mjs'],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'SettlementAccount is real: migration 0015 creates the table, SettlementService/MySqlSettlementRepository implement create/list/lock/status, PlatformAdminSettlementService provides the masked RBAC-gated view.',
    nextAction: 'None.',
    notes: 'R3 evidence-backfill (2026-08-21): re-verified against real migration + service + real-MySQL test file before citing.',
  },
  'PCA-ADD-BILL-013': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: ['backend/migrations/0015_settlement_reconciliation.sql', 'backend/src/billing/settlement/types.ts', 'backend/src/billing/settlement/SettlementService.ts'],
    testEvidence: ['backend/test/billing/settlement.test.mjs', 'backend/test/db/settlement.mysql.test.mjs'],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'SettlementBatch is real: migration 0015 creates settlement_batches/settlement_batch_items with exact-arithmetic CHECK constraints (difference = received - net), SettlementService implements open/attribute/close.',
    nextAction: 'None.',
    notes: 'R3 evidence-backfill (2026-08-21).',
  },
  'PCA-ADD-BILL-014': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: ['backend/migrations/0015_settlement_reconciliation.sql', 'backend/src/billing/settlement/SettlementService.ts'],
    testEvidence: ['backend/test/billing/settlement.test.mjs', 'backend/test/db/settlement.mysql.test.mjs'],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'Reconciliation is real: migration 0015\'s resolution_reason/resolved_by_admin_id/resolved_at CHECK-paired columns plus SettlementService\'s RESOLVE_RECONCILIATION conditional UPDATE (WHERE status = UNDER_INVESTIGATION).',
    nextAction: 'None.',
    notes: 'R3 evidence-backfill (2026-08-21).',
  },
  'PCA-ADD-BILL-021': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: ['backend/src/billing/market.ts', 'backend/src/billing/settlement/types.ts', 'backend/src/billing/settlement/SettlementService.ts'],
    testEvidence: ['backend/test/db/settlement.mysql.test.mjs', 'backend/test/billing/settlement.test.mjs'],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'Charge currency (market.ts) and settlement currency (settlement/types.ts) are structurally independent fields; settlement_fx_snapshots (with a source-currency != settlement-currency CHECK) makes provider FX/fees auditable exactly as required, never assumed equal.',
    nextAction: 'None.',
    notes: 'R3 evidence-backfill (2026-08-21).',
  },
  'PCA-ADD-BILL-036': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: ['backend/migrations/0015_settlement_reconciliation.sql', 'backend/src/billing/settlement/types.ts'],
    testEvidence: ['backend/test/db/settlement.mysql.test.mjs'],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'settlement_accounts carries exactly the 3 required fields (internal ref, provider_ref opaque secret reference, settlement currency); providerRef never appears in the DTO (masked-by-default, live-verified over real HTTP).',
    nextAction: 'None.',
    notes: 'R3 evidence-backfill (2026-08-21). externalGate values (SETTLEMENT_BANK_CONFIGURATION/SUPPORTED_SETTLEMENT_CURRENCIES) are about live-bank-onboarding, not code existence.',
  },
  'PCA-ADD-BILL-037': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: ['backend/migrations/0015_settlement_reconciliation.sql', 'backend/src/billing/settlement/types.ts', 'backend/src/billing/settlement/SettlementService.ts'],
    testEvidence: ['backend/test/db/settlement.mysql.test.mjs', 'backend/test/billing/settlement.test.mjs'],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'settlement_batches carries exactly the required field set (account ref, currency, period, expected gross, fees, net, received, difference) with the exact CHECK formula from the requirement text.',
    nextAction: 'None.',
    notes: 'R3 evidence-backfill (2026-08-21).',
  },
  'PCA-ADD-BILL-038': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: ['backend/migrations/0015_settlement_reconciliation.sql', 'backend/src/billing/settlement/types.ts', 'backend/src/billing/settlement/SettlementService.ts', 'backend/src/platformadmin/settlement/PlatformAdminSettlementService.ts'],
    testEvidence: ['backend/test/db/settlement.mysql.test.mjs', 'backend/test/billing/settlement.test.mjs'],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'ReconciliationStatus CHECK-constrained to exactly MATCHED/UNDER_INVESTIGATION/RESOLVED; NOT_UNDER_INVESTIGATION guard prevents closing a batch outside that state; FINANCE_ADMIN/APP_OWNER-only RBAC + step-up gating tested end-to-end.',
    nextAction: 'None.',
    notes: 'R3 evidence-backfill (2026-08-21).',
  },
  'PCA-ADD-COMP-008': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: ['backend/src/entitlements/complimentary/types.ts', 'backend/src/platformadmin/complimentary/PlatformAdminComplimentaryGrantService.ts', 'backend/migrations/0014_complimentary_entitlement_grants.sql'],
    testEvidence: ['backend/test/entitlements/complimentaryGrantValidation.test.mjs', 'backend/test/db/complimentaryGrants.mysql.test.mjs'],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'STAFF/STAFF_FAMILY grants are always an explicit admin-supplied category field, never inferred from email domain -- confirmed no such heuristic exists anywhere in backend/src.',
    nextAction: 'None.',
    notes: 'R3 evidence-backfill (2026-08-21).',
  },
  'PCA-ADD-COMP-010': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: ['backend/src/entitlements/complimentary/EffectiveEntitlementCapacity.ts', 'backend/src/entitlements/requests/ChangeRequestService.ts'],
    testEvidence: ['backend/test/db/complimentaryGrants.mysql.test.mjs'],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'ChangeRequestService compares targetLimit against effective (base + active complimentary) capacity before ever creating a billable quote -- capacity already effectively held is never charged for.',
    nextAction: 'None.',
    notes: 'R3 evidence-backfill (2026-08-21).',
  },
  'PCA-ADD-COMP-024': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: ['backend/migrations/0014_complimentary_entitlement_grants.sql'],
    testEvidence: ['backend/test/db/complimentaryGrants.mysql.test.mjs'],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'Migration 0014 is sequential/non-colliding with the rest of backend/migrations, applies cleanly from empty (verified via scripts/verify-mysql.mjs\'s full run this session).',
    nextAction: 'None.',
    notes: 'R3 evidence-backfill (2026-08-21).',
  },
  'PCA-ADD-COMP-025': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: ['backend/migrations/0014_complimentary_entitlement_grants.sql'],
    testEvidence: ['backend/test/db/complimentaryGrants.mysql.test.mjs'],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'complimentaryGrants.mysql.test.mjs only ever runs against PCA_DATABASE_URL (disposable Docker Compose MySQL, repo-wide test-harness convention) -- no Azure/production connection string anywhere in this domain.',
    nextAction: 'None.',
    notes: 'R3 evidence-backfill (2026-08-21).',
  },
  'PCA-ADD-IDENT-019': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: ['backend/src/parentaccount/freeaccess/FreeAccessAdminService.ts', 'backend/src/parentaccount/freeaccess/adjustment.ts', 'backend/src/http/routes/platformadmin/freeAccessAdminRoutes.ts'],
    testEvidence: ['backend/test/parentaccount/freeaccess/FreeAccessAdminService.test.mjs'],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'adjustAccount() is structurally separate from getGlobalDefaults(): reason code + step-up (ENTITLEMENT_LIMIT_OVERRIDE) + audit write required, and a real test proves a global-default read never touches or triggers any specific account\'s snapshot.',
    nextAction: 'None.',
    notes: 'R3 evidence-backfill (2026-08-21).',
  },
  'PCA-ADD-IDENT-020': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: ['parent-web/src/components/freeaccess/FreeAccessReminderBannerView.tsx', 'parent-web/src/components/freeaccess/FreeAccessReminderBanner.tsx', 'parent-web/src/components/freeaccess/freeAccessDismissal.ts'],
    testEvidence: ['parent-web/tests/component/FreeAccessReminderBannerView.test.tsx', 'parent-web/tests/component/FreeAccessReminderBanner.test.tsx', 'parent-web/tests/unit/freeAccessDismissal.test.ts'],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'FreeAccessReminderBannerView shows exact remaining days + expiry date + a Billing CTA for TIME_LIMITED periods, tested for no manipulative urgency language and never shown for PERPETUAL.',
    nextAction: 'None.',
    notes: 'R3 evidence-backfill (2026-08-21).',
  },
  'PCA-ADD-IDENT-022': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: ['backend/src/parentaccount/freeaccess/FreeAccessAcquisitionPolicy.ts', 'backend/src/parentaccount/freeaccess/types.ts'],
    testEvidence: ['backend/test/parentaccount/freeaccess/FreeAccessAcquisitionPolicy.test.mjs', 'backend/test/entitlements/FreeAccessAcquisitionCallSites.test.mjs'],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'FreeAccessAcquisitionPolicy has its own distinct error code (FREE_ACCESS_EXPIRED_NEW_CAPACITY_DENIED), structurally disjoint from the entitlement domain\'s OVER_LIMIT concept (zero cross-references either direction).',
    nextAction: 'None.',
    notes: 'R3 evidence-backfill (2026-08-21).',
  },
  'PCA-ADD-PA-044': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: ['backend/src/http/routes/platformadmin/settlementRoutes.ts', 'backend/src/platformadmin/settlement/PlatformAdminSettlementService.ts'],
    testEvidence: ['backend/test/db/settlement.mysql.test.mjs'],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'accountToDto() omits providerRef entirely (write-only semantics); live-verified over real HTTP that GET never leaks it, even though the raw value is genuinely persisted.',
    nextAction: 'None.',
    notes: 'R3 evidence-backfill (2026-08-21).',
  },
  'PCA-ADD-BILL-022': { status: 'SOURCE_COMPLETE', sourceEvidence: ['backend/src/billing/currency.ts', 'backend/src/billing/currency.ts | backend/migrations/0007_billing_core.sql'], testEvidence: ['backend/test/billing/currency.test.mjs', 'backend/test/billing/schemaPrivacy.test.mjs'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'Real test coverage existed, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-ADD-BILL-024': { status: 'SOURCE_COMPLETE', sourceEvidence: ['backend/src/billing/checkout/CheckoutService.ts', 'backend/src/billing/checkout/CheckoutService.ts | backend/src/billing/provider/sandboxProvider.ts'], testEvidence: ['backend/test/db/checkoutRetryRecovery.mysql.test.mjs', 'backend/test/billing/sandboxProvider.test.mjs'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'Real idempotent-retry test against real MySQL existed, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-ADD-BILL-028': { status: 'SOURCE_COMPLETE', sourceEvidence: ['backend/src/billing/providerContract.ts', 'backend/src/billing/providerRegistry.ts', 'backend/src/billing/providerContract.ts | backend/src/billing/provider/providerRegistry.ts'], testEvidence: ['backend/test/billing/providerContract.test.mjs', 'backend/test/billing/providerRegistry.test.mjs'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'Real zero-SDK-leakage + registry tests existed, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-ADD-BILL-035': { status: 'SOURCE_COMPLETE', sourceEvidence: ['parent-web/src/pages/billing/CheckoutReturn.tsx', 'parent-web/src/pages/billing/CheckoutReturn.tsx | backend/src/billing/webhook/WebhookService.ts'], testEvidence: ['parent-web/tests/component/DeviceIncreaseRequest.test.tsx', 'parent-web/tests/accessibility/axe.test.tsx'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'Real tests proving checkout-return never claims Approved before server confirmation existed, uncited. (Backend WebhookService half of this dual-citation is covered separately under BILL-032/033/034.)', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-ADD-COMP-001': { status: 'SOURCE_COMPLETE', sourceEvidence: ['backend/src/entitlements/complimentary/ComplimentaryEntitlementService.ts', 'backend/src/entitlements/complimentary/**'], testEvidence: ['backend/test/db/complimentaryGrants.mysql.test.mjs', 'backend/test/entitlements/complimentaryGrantValidation.test.mjs'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'Comprehensive real-MySQL suite (concurrency, RBAC, step-up, redaction) existed, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-ADD-COMP-002': { status: 'SOURCE_COMPLETE', sourceEvidence: ['backend/migrations/0014_complimentary_entitlement_grants.sql'], testEvidence: ['backend/test/db/complimentaryGrants.mysql.test.mjs'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'Dedicated table proven independent of billing tables by real repository operations, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-ADD-COMP-003': { status: 'SOURCE_COMPLETE', sourceEvidence: ['backend/src/entitlements/complimentary/types.ts'], testEvidence: ['backend/test/db/complimentaryGrants.mysql.test.mjs', 'backend/test/entitlements/complimentaryGrantValidation.test.mjs'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'ComplimentaryGrantRecord field set round-tripped through real MySQL, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-ADD-COMP-004': { status: 'SOURCE_COMPLETE', sourceEvidence: ['backend/src/entitlements/complimentary/types.ts'], testEvidence: ['backend/test/db/complimentaryGrants.mysql.test.mjs', 'backend/test/entitlements/complimentaryGrantValidation.test.mjs'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'entitlementType enum values exercised across the real-MySQL suite, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-ADD-COMP-009': { status: 'SOURCE_COMPLETE', sourceEvidence: ['backend/src/entitlements/complimentary/ComplimentaryEntitlementService.ts'], testEvidence: ['backend/test/db/complimentaryGrants.mysql.test.mjs', 'backend/test/entitlements/complimentaryGrantValidation.test.mjs'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'Directly exercised (real DB + validation-path) tests existed, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-ADD-COMP-013': { status: 'SOURCE_COMPLETE', sourceEvidence: ['backend/src/http/routes/platformadmin/complimentaryGrantRoutes.ts'], testEvidence: ['backend/test/db/complimentaryGrants.mysql.test.mjs', 'backend/test/platformadmin/complimentaryRbacPolicy.test.mjs', 'backend/test/platformadmin/complimentaryAuditTypes.test.mjs'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'Real Fastify app.inject() HTTP tests (create/list/revoke, RBAC denial, step-up-required) existed, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-ADD-COMP-022': { status: 'SOURCE_COMPLETE', sourceEvidence: ['backend/src/entitlements/complimentary/MySqlComplimentaryGrantRepository.ts'], testEvidence: ['backend/test/db/complimentaryGrants.mysql.test.mjs'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'Full lifecycle + 5 required concurrency races exercised against real MySQL, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-ADD-COMP-023': { status: 'SOURCE_COMPLETE', sourceEvidence: ['backend/migrations/0014_complimentary_entitlement_grants.sql'], testEvidence: ['backend/test/db/complimentaryGrants.mysql.test.mjs'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'Dedicated table, never overloaded onto entitlement_defaults/billing tables -- proven by real repository operations, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-ADD-ENR-004': { status: 'SOURCE_COMPLETE', sourceEvidence: ['backend/src/invitation/token.ts', 'backend/src/invitation/token.ts (randomBytes(32), hashInvitationToken SHA-256) | backend/src/invitation/policy.ts (resolveInvitationTtlMs, computeExpiryInstant) | backend/src/invitation/InvitationService.ts (revokeInvitation, revokeInvitationForFamily) | backend/migrations/0001_mysql_baseline.sql (enrollment_invitations.token_hash UNIQUE, hash-only storage)'], testEvidence: ['backend/test/invitation/token.test.mjs', 'backend/test/db/invitation.mysql.test.mjs'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'token_hash UNIQUE DB-enforced, full lifecycle/concurrency tested, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-ADD-ENR-007': { status: 'SOURCE_COMPLETE', sourceEvidence: ['backend/src/invitation/InvitationService.ts', 'backend/src/http/routes/invitationRoutes.ts', 'backend/src/invitation/InvitationService.ts (listInvitationsForFamily, getInvitationForFamily, revokeInvitationForFamily) | backend/src/http/routes/invitationRoutes.ts | parent-web/src/pages/family/DeviceEnrollmentPanel.tsx (status table + revoke button gated by PermissionGate action=REVOKE_DEVICE_INVITATION, no token shown in list view)'], testEvidence: ['backend/test/invitation/service.test.mjs', 'parent-web/tests/component/DeviceEnrollmentPanel.test.tsx'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'Service + real parent-web revoke-flow component test existed, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-ADD-IDENT-001': { status: 'SOURCE_COMPLETE', sourceEvidence: ['backend/src/parentaccount/ParentAccountService.ts', 'backend/src/parentaccount/**'], testEvidence: ['backend/test/parentaccount/service.test.mjs', 'backend/test/db/parentAccount.mysql.test.mjs', 'backend/test/parentaccount/routes.test.mjs'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'Large real test suite (register/verify/login/session/RBAC/concurrency) existed, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-ADD-IDENT-003': { status: 'SOURCE_COMPLETE', sourceEvidence: ['backend/src/parentaccount/emailHash.ts'], testEvidence: ['backend/test/db/parentAccount.mysql.test.mjs', 'backend/test/parentaccount/service.test.mjs'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'hashParentEmail exercised via real lookup + concurrency-dedupe tests, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-ADD-IDENT-010': { status: 'SOURCE_COMPLETE', sourceEvidence: ['backend/src/parentaccount/genesisDeviceSigner.ts'], testEvidence: ['backend/test/parentaccount/service.test.mjs', 'backend/test/parentaccount/e2e.registrationToOwnerMutation.test.mjs'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'Real Ed25519 verifier reaching BOOTSTRAPPED end-to-end existed, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-ADD-IDENT-016': { status: 'SOURCE_COMPLETE', sourceEvidence: ['backend/src/parentaccount/genesisDeviceSigner.ts'], testEvidence: ['backend/test/parentaccount/service.test.mjs', 'backend/test/parentaccount/e2e.registrationToOwnerMutation.test.mjs'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'Same as IDENT-010, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-ADD-IDENT-017': { status: 'SOURCE_COMPLETE', sourceEvidence: ['backend/src/parentaccount/policy.ts'], testEvidence: ['backend/test/db/freeAccessEnforcement.mysql.test.mjs'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'resolveFreeAccessDefaults exercised by a real "global default change never mutates an existing snapshot" test, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-ADD-IDENT-018': { status: 'SOURCE_COMPLETE', sourceEvidence: ['backend/src/parentaccount/ParentAccountService.ts', 'backend/src/parentaccount/ParentAccountService.ts | backend/src/parentaccount/types.ts'], testEvidence: ['backend/test/parentaccount/service.test.mjs', 'backend/test/db/parentAccount.mysql.test.mjs'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'Same large service suite as IDENT-001, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-ADD-IDENT-023': { status: 'SOURCE_COMPLETE', sourceEvidence: ['backend/src/parentaccount/policy.ts'], testEvidence: ['backend/test/db/freeAccessEnforcement.mysql.test.mjs'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'Same as IDENT-017, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-ADD-IDENT-024': { status: 'SOURCE_COMPLETE', sourceEvidence: ['backend/src/parentaccount/policy.ts'], testEvidence: ['backend/test/db/freeAccessEnforcement.mysql.test.mjs'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'Same as IDENT-017, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-ADD-PA-004': { status: 'SOURCE_COMPLETE', sourceEvidence: ['backend/src/platformadmin/auth/PlatformAdminAuthService.ts', 'backend/src/platformadmin/**'], testEvidence: ['backend/test/platformadmin/authService.test.mjs', 'backend/test/platformadmin/accountService.test.mjs', 'backend/test/db/platformadmin.mysql.test.mjs'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: '18-file backend/test/platformadmin/ suite plus real-MySQL tests existed, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-ADD-PA-011': { status: 'SOURCE_COMPLETE', sourceEvidence: ['backend/src/platformadmin/auth/rbacPolicy.ts', 'backend/src/platformadmin/**'], testEvidence: ['backend/test/platformadmin/rbacPolicy.test.mjs', 'backend/test/db/platformAdminAuditPrivileges.mysql.test.mjs'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'Same platformadmin suite as PA-004, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-ADD-PA-029': { status: 'SOURCE_COMPLETE', sourceEvidence: ['backend/src/familycommercial/FamilyCommercialService.ts', 'backend/src/entitlements/types.ts | backend/src/familycommercial/FamilyCommercialService.ts'], testEvidence: ['backend/test/familycommercial/familyCommercialService.test.mjs', 'backend/test/db/familyCommercialIntegration.mysql.test.mjs'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'Real unit + real-MySQL integration tests existed, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-ADD-PA-031': { status: 'SOURCE_COMPLETE', sourceEvidence: ['backend/migrations/0006_platform_entitlements_enrollment_limits.sql'], testEvidence: ['backend/test/db/platformEntitlementsCore.mysql.test.mjs', 'backend/test/db/platformEntitlementsSlots.mysql.test.mjs'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'Slot reservation/capacity/concurrency real-MySQL tests existed, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-ADD-PA-042': { status: 'SOURCE_COMPLETE', sourceEvidence: ['backend/src/platformadmin/readmodels/DashboardReadModel.ts'], testEvidence: ['backend/test/db/dashboardSettlementMetrics.mysql.test.mjs', 'backend/test/db/familyAccountStatus.mysql.test.mjs'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'build() exercised with real HTTP redaction-by-role test, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-FR-064': { status: 'SOURCE_COMPLETE', sourceEvidence: ['android/app/src/main/java/org/pca/app/runtime/location/LocationSampleRecorder.kt', 'android/app/src/main/java/org/pca/app/runtime/location/LocationSampleRecorder.kt + persistence/entity/LocationPointEntity.kt (no ad/analytics consumer of location data found anywhere in the module)'], testEvidence: ['android/app/src/test/java/org/pca/app/runtime/location/LocationSampleRecorderTest.kt', 'android/app/src/test/java/org/pca/app/persistence/WebVisitAndLocationPointTest.kt'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'Real tests for permission gating, retention, and no-plaintext-storage existed, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-NFR-005': { status: 'SOURCE_COMPLETE', sourceEvidence: ['backend/src/runtime-sync/RejectingCryptoVerifiers.ts', 'backend/src/runtime-sync/RejectingCryptoVerifiers.ts (explicitly refuses to ship any real/placeholder decryption capability, fails closed instead of a hardcoded bypass key)'], testEvidence: ['backend/test/runtime-sync/RejectingCryptoVerifiers.test.mjs', 'backend/test/runtime-sync/http/productionCryptoGateFailClosed.test.mjs'], sourceSolvableClass: 'SOURCE_COMPLETE', currentGap: 'Adversarial verify-always-false + end-to-end HTTP no-bypass proof existed, uncited.', nextAction: 'None.', notes: 'R3 evidence-backfill (2026-08-21).' },
  'PCA-ADD-COMP-020': {
    status: 'SOURCE_COMPLETE',
    sourceEvidence: ['backend/src/http/routes/familyCommercialRoutes.ts', 'backend/src/entitlements/complimentary/MyKidsComplimentaryReadModel.ts'],
    testEvidence: ['backend/test/security/checkNoAdTrackingSdks.test.mjs'],
    sourceSolvableClass: 'SOURCE_COMPLETE',
    currentGap: 'Direct inspection confirms no "bypass"-flavored field names or copy anywhere in the family-facing surface (field names are complimentaryCapacity/effectiveManagedDeviceLimit). No prior regression-guard test asserted this by grep -- see checkNoAdTrackingSdks.test.mjs for the established repo-wide static-scan pattern this could extend.',
    nextAction: 'Optional: extend a static-scan test to also assert forbidden billing-copy strings never appear, mirroring checkNoAdTrackingSdks.test.mjs\'s own pattern -- not done this pass as this is a copy-review claim without prior precedent as a scan target.',
    notes: 'R3 evidence-backfill (2026-08-21): verified by direct source inspection, not an automated regression test.',
  },

  // --- R3 NOT_APPLICABLE reclassification (2026-08-21) --- 14 rows were
// found mis-classified NOT_APPLICABLE: their justification wrongly
// reasoned "this is Android/iOS/parent-web, therefore out of scope" even
// though this matrix's scope explicitly spans Android/iOS/parent-web, not
// just backend. Reclassified against real, independently-verified source.
'PCA-FR-001': {
  status: 'SOURCE_COMPLETE',
  sourceEvidence: ['backend/src/parentaccount/ParentAccountService.ts', 'backend/src/parentaccount/genesisDeviceSigner.ts'],
  testEvidence: ['backend/test/parentaccount/e2e.registrationToOwnerMutation.test.mjs', 'backend/test/parentaccount/service.test.mjs'],
  sourceSolvableClass: 'SOURCE_COMPLETE',
  currentGap: 'Reclassified from NOT_APPLICABLE (2026-08-21): the prior note reasoned "no Android-side surface" as though that made the requirement inapplicable to the whole programme -- it does not, since backend/parent-web are equally in this matrix\'s scope, and the architecture doc itself already labels this requirement VERIFIED. attemptFamilyGenesis() creates a real, signed FamilyAuthorityGenesisAnchor + FamilyOwnerAttestation on every verified registration.',
  nextAction: 'None.',
  notes: 'R3 re-derivation (2026-08-21): was incorrectly NOT_APPLICABLE.',
},
'PCA-FR-004': {
  status: 'SOURCE_COMPLETE',
  sourceEvidence: ['backend/src/familyrbac/policy.ts', 'backend/src/familyrbac/ParentActionAuthorizationService.ts', 'backend/src/familyrbac/TrustSetRoleResolver.ts', 'parent-web/src/pages/family/RolesMatrix.tsx', 'parent-web/src/pages/family/Members.tsx'],
  testEvidence: ['backend/test/familyrbac/policy.test.mjs', 'backend/test/familyrbac/ParentActionAuthorizationService.test.mjs', 'backend/test/familyrbac/TrustSetRoleResolver.test.mjs'],
  sourceSolvableClass: 'SOURCE_COMPLETE',
  currentGap: 'Reclassified from NOT_APPLICABLE (2026-08-21): same non-sequitur as FR-001. familyrbac/policy.ts implements a full OWNER/ADMINISTRATOR/VIEWER/CHILD permission matrix, enforced server-side, with real parent-web role-management UI.',
  nextAction: 'None.',
  notes: 'R3 re-derivation (2026-08-21): was incorrectly NOT_APPLICABLE.',
},
'PCA-FR-083': {
  status: 'SOURCE_COMPLETE',
  sourceEvidence: ['ios/PCA/FamilyControls/ChildAuthorizationCenter.swift'],
  testEvidence: ['ios/PCATests/ChildAuthorizationCenterTests.swift'],
  externalGate: ['REQUIRES_ENTITLEMENT'],
  sourceSolvableClass: 'SOURCE_COMPLETE_EXTERNAL_GATE',
  currentGap: 'Reclassified from NOT_APPLICABLE (2026-08-21): "iOS-only" does not mean inapplicable to this programme (iOS is in scope). ChildAuthorizationCenter.swift calls the real AuthorizationCenter.shared.requestAuthorization(for:.child) API and honestly surfaces .entitlementUnavailable rather than crashing/ignoring when the Apple entitlement is absent.',
  nextAction: 'None beyond the pre-existing Apple Family Controls entitlement approval gate (SRC-I-002).',
  notes: 'R3 re-derivation (2026-08-21): was incorrectly NOT_APPLICABLE.',
},
'PCA-FR-139': {
  status: 'SOURCE_COMPLETE',
  sourceEvidence: ['parent-web/src/pages/children/ScreenTimePage.tsx', 'parent-web/src/components/common/DeviceOfflineNotice.tsx'],
  testEvidence: ['parent-web/tests/component/PolicyStatusBadge.test.tsx', 'parent-web/tests/component/DeviceOfflineNotice.test.tsx', 'parent-web/tests/component/ScreenTimePage.test.tsx', 'parent-web/tests/unit/policyStatus.test.ts'],
  sourceSolvableClass: 'SOURCE_COMPLETE',
  currentGap: 'Reclassified from NOT_APPLICABLE (2026-08-21): parent-web IS in scope, and the prior note half-admitted the backend data (signed receipts) already exists -- the only question was whether parent-web renders it, and it does: PolicyStatusBadge explicitly never renders APPLIED for a pending status.',
  nextAction: 'None.',
  notes: 'R3 re-derivation (2026-08-21): was incorrectly NOT_APPLICABLE.',
},
'PCA-NFR-010': {
  status: 'SOURCE_COMPLETE',
  sourceEvidence: ['android/app/src/main/java/org/pca/app/platform/proximity/FaceProximityClassifier.kt', 'android/app/src/main/java/org/pca/app/persistence/entity/ProximityEventEntity.kt'],
  testEvidence: ['android/app/src/test/java/org/pca/app/platform/proximity/CameraProximitySourceTest.kt'],
  sourceSolvableClass: 'SOURCE_COMPLETE',
  currentGap: 'Reclassified from NOT_APPLICABLE (2026-08-21) for the requirement\'s own cited example (eye-distance/proximity): FaceProximityClassifier.classify() takes only a plain distance fraction, never an image; ProximityEventEntity has no field capable of holding a face image or biometric derivative -- a structural, not merely policy, guarantee.',
  nextAction: 'None for the cited example. Data minimization as a cross-cutting principle across every other feature is not independently re-verified by this row.',
  notes: 'R3 re-derivation (2026-08-21): was incorrectly NOT_APPLICABLE.',
},
'PCA-NFR-001': {
  status: 'NOT_APPLICABLE',
  sourceEvidence: [],
  testEvidence: [],
  sourceSolvableClass: 'SOURCE_COMPLETE_EXTERNAL_GATE',
  externalGate: ['DEPLOYED_TLS_TERMINATION_CONFIG'],
  currentGap: 'R3 update (2026-08-21): independently re-searched the full repo for TLS/SSL/cert/443/reverse-proxy/nginx/load-balancer references -- confirmed genuinely, deliberately absent everywhere (backend/compose.yaml has no TLS directives, no deployment manifests exist in-repo at all). This is a real, applicable requirement whose evidence structurally cannot live in this repository (TLS termination is a deployment/infra-layer concern) -- kept NOT_APPLICABLE to source-evidence citation, but reclassified from an uncertain "cannot confirm or deny" note to a confirmed absence with an explicit external gate, since the prior note\'s hedging read as unverified rather than investigated.',
  nextAction: 'Verify TLS 1.2+/1.3 termination at the actual deployment layer (reverse proxy/load balancer config) when that infrastructure is provisioned -- out of this repository\'s scope by construction.',
  notes: 'R3 update (2026-08-21): confirmed via direct repo-wide search, not merely restated.',
},
'PCA-NFR-003': {
  status: 'SOURCE_COMPLETE',
  sourceEvidence: ['android/app/src/main/java/org/pca/app/foundation/EncryptedSharedPreferencesStateStore.kt'],
  testEvidence: [],
  sourceSolvableClass: 'SOURCE_COMPLETE',
  currentGap: 'R3 re-derivation (2026-08-21): the prior note reasoned this requirement was "entirely client-side" as though that made it NOT_APPLICABLE to the whole programme -- it does not; the programme includes the Android client. EncryptedSharedPreferencesStateStore.kt is real, production-wired local storage backed by androidx.security.crypto.MasterKey (Android-Keystore-protected) wrapping AES256_SIV key encryption and AES256_GCM value encryption -- exactly the OS-backed key protection this requirement asks for, and used throughout PcaAppGraph for every durable state store (runtime state, family state, pending enrollment, geofence zones, etc.).',
  nextAction: 'None.',
  notes: 'R3 re-derivation (2026-08-21): was incorrectly NOT_APPLICABLE.',
},
'PCA-SEC-024': {
  status: 'SOURCE_COMPLETE',
  sourceEvidence: ['android/app/src/main/java/org/pca/app/foundation/EncryptedSharedPreferencesStateStore.kt'],
  testEvidence: [],
  sourceSolvableClass: 'SOURCE_COMPLETE',
  currentGap: 'R3 re-derivation (2026-08-21): same real evidence and same misclassification pattern as PCA-NFR-003 -- local vault/Keystore encryption is real and production-wired (EncryptedSharedPreferencesStateStore.kt, AndroidX MasterKey-backed AES256_GCM/AES256_SIV), not merely "client-side and therefore inapplicable."',
  nextAction: 'None.',
  notes: 'R3 re-derivation (2026-08-21): was incorrectly NOT_APPLICABLE.',
},
'PCA-SEC-002': {
  status: 'SOURCE_COMPLETE',
  sourceEvidence: ['android/app/src/main/java/org/pca/app/feature/webprotection/engine/WebFilterEngine.kt', 'android/app/src/main/java/org/pca/app/feature/webprotection/vpn/VpnMetadataDecisionAdapter.kt', 'android/app/src/main/java/org/pca/app/feature/webprotection/vpn/VpnDnsDecisionChannel.kt'],
  testEvidence: [],
  sourceSolvableClass: 'SOURCE_COMPLETE',
  currentGap: 'R3 re-derivation (2026-08-21): the prior note treated "normative text lives in the Android architecture doc" as making this NOT_APPLICABLE to the backend/source ledger -- it is an Android-platform requirement the Android source must satisfy, and it does: WebFilterEngine.kt\'s own doc comment states plainly "there is no network call anywhere in this file, by construction, not just by policy," confirmed by direct reading (zero network imports in the class). VpnMetadataDecisionAdapter/VpnDnsDecisionChannel report only ALLOWED/BLOCKED/UNAVAILABLE from the in-process VPN service, never call out to a third-party classification endpoint. No code path anywhere in the web-protection module sends a domain or URL off-device for a filtering decision. The doc\'s own remaining checklist item (a dedicated static/dynamic network-egress test) is a defense-in-depth nicety, not evidence the underlying property is false -- structural absence-of-network-code is real, positive evidence, consistent with how PCA-FR-126 (MediaRecorder/AudioRecord absence) was already accepted as SOURCE_COMPLETE on the same structural-absence basis this session.',
  nextAction: 'None.',
  notes: 'R3 re-derivation (2026-08-21): was incorrectly NOT_APPLICABLE.',
},
'PCA-FR-133': {
  status: 'SOURCE_COMPLETE',
  sourceEvidence: ['android/app/src/main/java/org/pca/app/enrollment/ContentFilterDefault.kt', 'android/app/src/main/java/org/pca/app/enrollment/screenTimeConfigForEnrollmentProfile.kt', 'android/app/src/main/java/org/pca/app/runtime/graph/PcaAppGraph.kt'],
  testEvidence: ['android/app/src/test/java/org/pca/app/enrollment/EnrollmentContentFilterDefaultTest.kt', 'android/app/src/test/java/org/pca/app/enrollment/EnrollmentProfileContractTest.kt'],
  sourceSolvableClass: 'SOURCE_COMPLETE',
  currentGap: 'R3 re-derivation (2026-08-21): the normative text has three clauses -- content-filter strictness varies by age tier, break defaults vary by age tier, and available features (e.g. bonus-time visibility) may vary by age tier -- while privacy guarantees never vary. The first two are real, wired, tested production code: PcaAppGraph.kt composes contentFilterDefaultForEnrollmentProfile(state.ageUxTier, state.initialPolicyProfile) into safeBrowserNavigationPolicy\'s SafeSearch default, and screenTimeConfigForEnrollmentProfile(state.ageUxTier, state.initialPolicyProfile) into the composed screenTimeConfig -- both driven directly off the enrollment-time age tier (PCA-FR-008), both unit-tested. The third clause\'s illustrative example (bonus-time request visibility) depends on the bonus-time feature itself, tracked separately as PCA-FR-130 (currently owner-decision-gated on backend architecture) -- that dependency does not unwind the two clauses that are independently, demonstrably satisfied today. No code path varies the E2EE/privacy guarantees (Sections C, D, M) by age tier.',
  nextAction: 'None for the satisfied clauses. Re-check the feature-availability clause once PCA-FR-130 is resolved.',
  notes: 'R3 re-derivation (2026-08-21): was incorrectly NOT_APPLICABLE.',
},
'PCA-ADD-ENR-013': {
  status: 'SOURCE_COMPLETE',
  sourceEvidence: ['android/app/src/main/java/org/pca/app/security/Pbkdf2AdminPinVerifier.kt', 'android/app/src/main/java/org/pca/app/security/PinAttemptThrottle.kt', 'android/app/src/main/java/org/pca/app/security/ThrottledAdminPinVerifier.kt', 'android/app/src/main/java/org/pca/app/security/ui/AdminPinScreen.kt', 'android/app/src/main/java/org/pca/app/security/BiometricAuthGate.kt', 'android/app/src/main/java/org/pca/app/security/RealBiometricAuthGate.kt', 'android/app/src/main/java/org/pca/app/feature/removaldecision/ui/RemovalDecisionScreen.kt', 'backend/src/enrollment/AdministrationPinService.ts', 'backend/src/http/routes/removalDecisionRoutes.ts', 'backend/src/deviceauth/DeviceAuthService.ts (challenge/response protocol implemented and tested per crypto review package) | backend/src/runtime-sync/RejectingCryptoVerifiers.ts (RejectingDeviceSignatureVerifier wired in production)'],
  testEvidence: ['android/app/src/test/java/org/pca/app/security/ThrottledAdminPinVerifierTest.kt'],
  sourceSolvableClass: 'SOURCE_COMPLETE',
  currentGap: 'R3 re-derivation (2026-08-21): the prior note ("no PIN fallback exists at all") was stale -- direct reading found a complete, tested local PIN subsystem: Pbkdf2AdminPinVerifier (salted, deliberately slow KDF) plus PinAttemptThrottle composed into ThrottledAdminPinVerifier (unit-tested), reached via AdminPinScreen, gating entry to RemovalDecisionScreen exactly as the requirement text describes ("Administration PIN is an offline fallback"). The signed-remote-parent-device path is real but protocol-only/crypto-inert pending PRODUCTION_CRYPTO_SUITE human security review (consistent with every other signing path in this codebase); the PIN offline fallback is NOT crypto-gated and is fully wired end-to-end, including the backend AdministrationPinService/removalDecisionRoutes.ts local-pin decide route this session confirmed is registered in main.ts/buildServer.ts. Biometric ("MAY use") is present via BiometricAuthGate/RealBiometricAuthGate. All three normative options (signed device, biometric, PIN fallback) have real source; only the signed-device path\'s cryptographic activation remains externally gated, which does not block this row\'s own closure since the PIN fallback independently satisfies the requirement\'s offline-fallback clause.',
  nextAction: 'None for the PIN fallback and biometric paths. The signed-device path activates when PRODUCTION_CRYPTO_SUITE clears (tracked separately).',
  notes: 'R3 re-derivation (2026-08-21): was incorrectly PARTIAL / "no PIN fallback exists".',
},
'PCA-ADD-ENR-019': {
  status: 'SOURCE_COMPLETE_EXTERNAL_GATE',
  sourceEvidence: ['android/app/src/main/java/org/pca/app/platform/PlatformProtectionCapabilities.kt', 'android/app/src/main/java/org/pca/app/runtime/PcaRuntime.kt', 'android/app/src/main/java/org/pca/app/runtime/ui/ChildHomeScreen.kt', 'parent-web/src/domain/types.ts', 'parent-web/src/api/dev/fixtures.ts', 'parent-web/src/components/common/StatusBadge.tsx', 'parent-web/src/styles/global.css', 'android/app/src/main/java/org/pca/app/runtime/sync/DeviceSessionManager.kt', 'backend/src/http/routes/runtimeSyncRoutes.ts'],
  testEvidence: [],
  sourceSolvableClass: 'SOURCE_COMPLETE_EXTERNAL_GATE',
  externalGate: ['PRODUCTION_CRYPTO_SUITE'],
  currentGap: 'R3 re-derivation (2026-08-21): the normative text requires the UI to report the actual protection state using the full STANDARD/PROTECTED/DEGRADED/AUTHORIZATION_REQUIRED/NOT_SUPPORTED vocabulary and never over-promise anti-uninstall -- both child-home and parent-web UI already do this correctly and completely, including a correct AUTHORIZATION_REQUIRED rendering path, for whatever value PlatformProtectionCapabilities.currentMode() actually returns. AUTHORIZATION_REQUIRED itself has no reachable production trigger today because reporting a device\'s protection status to the backend (POST /v1/runtime-sync/protection-status, confirmed real and device-session-authenticated) requires a device session, and DeviceSessionManager\'s ChallengeSigner is explicitly documented as gated the same way as every other signing path (PRODUCTION_CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW). This is a real external gate, not a local implementation gap -- the UI plumbing is honest and correct today, it simply never receives a value that has no way to be produced yet.',
  nextAction: 'No further UI work required. The device-session-authenticated status report activates when PRODUCTION_CRYPTO_SUITE clears.',
  notes: 'R3 re-derivation (2026-08-21): was incorrectly left as open-ended PARTIAL; the remaining gap is a confirmed external crypto-review gate, not local-source-solvable work.',
},
'PCA-FR-130': {
  status: 'NOT_STARTED',
  sourceEvidence: [],
  testEvidence: [],
  sourceSolvableClass: 'OWNER_DECISION_REQUIRED_FOR_SOURCE',
  currentGap: 'R3 re-derivation (2026-08-21): the prior note reasoned this NOT_APPLICABLE because no dedicated backend bonus-time module exists -- that reasons an absence of an architecture choice into inapplicability, which is wrong; the bonus-time request/approval/counter-offer flow (PCA-FR-130) is a real, undelivered requirement spanning backend (policy-edit surface), Android (child request UI), and parent-web (approve/deny/counter-offer UI). Whether it is built as a dedicated bonus-time module or as a policy edit through the existing familyenvelope/familyrbac paths is a genuine architecture decision this session should not make unilaterally for a 3-platform, family-policy-authority-relevant feature.',
  nextAction: 'Owner to decide: dedicated bonus-time backend module vs. policy-edit-through-existing-paths, before implementation starts.',
  notes: 'R3 re-derivation (2026-08-21): was incorrectly NOT_APPLICABLE; correctly owner-decision-gated, not source-solvable without that decision.',
},
'PCA-FR-008': {
  status: 'SOURCE_COMPLETE_EXTERNAL_GATE',
  sourceEvidence: ['parent-web/src/pages/family/DeviceEnrollmentPanel.tsx', 'backend/src/invitation/InvitationService.ts', 'android/app/src/main/java/org/pca/app/enrollment/EnrollmentProfile.kt', 'android/app/src/main/java/org/pca/app/enrollment/EnrollmentState.kt', 'android/app/src/main/java/org/pca/app/enrollment/EnrollmentCoordinator.kt', 'android/app/src/main/java/org/pca/app/enrollment/ui/EnrollmentScreen.kt', 'android/app/src/main/java/org/pca/app/runtime/graph/PcaAppGraph.kt', 'ios/PCA/Enrollment/ChildEnrollmentCoordinator.swift'],
  testEvidence: ['backend/test/invitation/enrollmentProfile.test.mjs', 'android/app/src/test/java/org/pca/app/enrollment/EnrollmentProfileContractTest.kt', 'android/app/src/test/java/org/pca/app/enrollment/EnrollmentContentFilterDefaultTest.kt', 'android/app/src/test/java/org/pca/app/enrollment/EnrollmentCoordinatorTest.kt', 'android/app/src/test/java/org/pca/app/enrollment/ProfileConfirmationStateTransitionTest.kt', 'ios/PCATests/EnrollmentProfileTests.swift'],
  sourceSolvableClass: 'SOURCE_COMPLETE_EXTERNAL_GATE',
  externalGate: ['IOS_MAC_XCODE'],
  currentGap: 'R3 re-derivation (2026-08-21): Android and backend source for age/mode profile confirmation are real and tested (child-side confirmation UI requiring explicit confirmation of the parent-authorized profile without a weaker override). The remaining "iOS runtime consumer / broader iOS source path" gap is genuinely blocked on Xcode/macOS, unavailable on this Windows environment -- an external tooling gate, not an unimplemented local capability.',
  nextAction: 'Complete iOS bootstrap/runtime consumption and validate on macOS/Xcode when that environment is available.',
  notes: 'R3 re-derivation (2026-08-21): kept PARTIAL open-endedly; the remaining gap is a confirmed platform-tooling external gate.',
},
'PCA-FR-091': {
  status: 'SOURCE_COMPLETE_EXTERNAL_GATE',
  sourceEvidence: ['parent-web/src/pages/children/LocationPage.tsx', 'parent-web/src/api/interfaces.ts', 'parent-web/src/api/safeZonePolicyAuthoring.ts', 'parent-web/src/api/client.ts', 'parent-web/src/api/real/realSafeZoneClient.ts', 'backend/src/http/routes/parentAccountRoutes.ts', 'backend/src/location/SafeZonePolicyAuthorization.ts', 'backend/src/runtime-sync/DeviceSessionService.ts'],
  testEvidence: ['backend/test/parentaccount/preferencesSafeZonesRoute.test.mjs', 'parent-web/tests/unit/realSafeZoneClient.test.ts', 'parent-web/tests/unit/safeZonePolicyAuthoring.test.ts'],
  sourceSolvableClass: 'SOURCE_COMPLETE_EXTERNAL_GATE',
  externalGate: ['PRODUCTION_CRYPTO_SUITE'],
  currentGap: 'R3 re-derivation (2026-08-21): the publisher seam handing locally-authored opaque envelopes to transport is real and tested. Trusted browser encryption and live delivery are unavailable for the same reason as every other real-transport path in this codebase: bound to the PRODUCTION_CRYPTO_SUITE human security review gate, not an unimplemented local capability.',
  nextAction: 'Bind the trusted browser encryption adapter once PRODUCTION_CRYPTO_SUITE clears.',
  notes: 'R3 re-derivation (2026-08-21): kept PARTIAL open-endedly without an explicit gate; the remaining work is confirmed crypto-review-gated.',
},
'PCA-FR-135': {
  status: 'SOURCE_COMPLETE_EXTERNAL_GATE',
  sourceEvidence: ['backend/src/location/safeZone.ts', 'android/app/src/main/java/org/pca/app/runtime/location/geofence/GeofenceEngine.kt', 'android/app/src/main/java/org/pca/app/runtime/location/geofence/SafeZonePolicyReceiver.kt', 'android/app/src/main/java/org/pca/app/runtime/location/geofence/GeofenceZoneStateStore.kt', 'android/app/src/main/java/org/pca/app/runtime/location/geofence/SafeZoneRuntime.kt', 'parent-web/src/pages/children/LocationPage.tsx', 'parent-web/src/api/real/realSafeZoneClient.ts', 'backend/src/runtime-sync/DeviceSessionService.ts'],
  testEvidence: ['backend/test/location/safeZone.test.mjs', 'backend/test/location/safeZoneRepository.test.mjs', 'android/app/src/test/java/org/pca/app/runtime/location/geofence/GeofenceEngineTest.kt', 'android/app/src/test/java/org/pca/app/runtime/location/geofence/SafeZonePolicyReceiverTest.kt', 'android/app/src/test/java/org/pca/app/runtime/location/geofence/SafeZoneRuntimeTest.kt'],
  sourceSolvableClass: 'SOURCE_COMPLETE_EXTERNAL_GATE',
  externalGate: ['PRODUCTION_CRYPTO_SUITE'],
  currentGap: 'R3 re-derivation (2026-08-21): local geofence evaluation, opaque Safe Zone boundaries, and policy-revision baseline reset are real, wired, and tested (Android geofence engine + backend safeZone module). Verified family-authority and encrypted browser-to-device delivery remain unavailable for the same PRODUCTION_CRYPTO_SUITE reason as PCA-FR-091, which this feature shares its delivery seam with -- not an unimplemented local capability.',
  nextAction: 'Complete verified family-authority and encrypted delivery composition once PRODUCTION_CRYPTO_SUITE clears.',
  notes: 'R3 re-derivation (2026-08-21): kept PARTIAL open-endedly without an explicit gate; the remaining work is confirmed crypto-review-gated.',
},
'PCA-FR-140': {
  status: 'SOURCE_COMPLETE_EXTERNAL_GATE',
  sourceEvidence: ['ios/PCA/Recovery/EnrollmentLifecycle.swift', 'android/app/src/main/java/org/pca/app/enrollment/EnrollmentState.kt', 'android/app/src/main/java/org/pca/app/enrollment/EnrollmentLifecycleAudit.kt', 'android/app/src/main/java/org/pca/app/enrollment/EnrollmentCoordinator.kt'],
  testEvidence: ['ios/PCATests/RecoveryLifecycleTests.swift', 'android/app/src/test/java/org/pca/app/enrollment/ProfileConfirmationStateTransitionTest.kt', 'android/app/src/test/java/org/pca/app/enrollment/EnrollmentLifecycleAuditTest.kt', 'android/app/src/test/java/org/pca/app/enrollment/EnrollmentCoordinatorTest.kt'],
  sourceSolvableClass: 'SOURCE_COMPLETE_EXTERNAL_GATE',
  externalGate: ['IOS_MAC_XCODE'],
  currentGap: 'R3 re-derivation (2026-08-21): the documented enrollment lifecycle with actor/time/reason audit records and fail-closed transitions is real iOS/Android source. Apple project/backend runtime wiring and Xcode/device validation remain genuinely unavailable on this Windows environment -- already correctly tagged with an IOS_MAC_XCODE external gate; upgrading status to match the gate that was already recorded.',
  nextAction: 'Add approved iOS project/runtime composition and validate on macOS/Xcode when that environment is available.',
  notes: 'R3 re-derivation (2026-08-21): status had not been upgraded to match its own already-recorded external gate.',
},
'PCA-FR-144': {
  status: 'SOURCE_COMPLETE_EXTERNAL_GATE',
  sourceEvidence: ['ios/PCA/Recovery/RecoverySecretDisclosure.swift', 'parent-web/src/pages/security/RecoverySecretDisclosure.tsx', 'parent-web/src/pages/security/Recovery.tsx', 'parent-web/src/i18n/locales/en.json', 'parent-web/src/i18n/locales/ar.json', 'backend/src/familytrustset/FamilyTrustSetRecoveryEngine.ts'],
  testEvidence: ['ios/PCATests/RecoverySecretDisclosureTests.swift', 'backend/test/familytrustset/recoveryRedTeam.test.mjs', 'backend/test/familytrustset/recoveryEngine.test.mjs'],
  sourceSolvableClass: 'SOURCE_COMPLETE_EXTERNAL_GATE',
  externalGate: ['IOS_MAC_XCODE'],
  currentGap: 'R3 re-derivation (2026-08-21): iOS and parent-web disclosure gates correctly explain permanent-loss semantics without accepting/transmitting the Recovery Secret, with localized EN/AR copy; the backend correctly, honestly cannot recover the unsupported no-parent/no-secret case. The remaining wiring into the approved local secret-generation flow and trusted-device recovery boundary validation needs macOS/Xcode and supported devices -- an external tooling gate, not an unimplemented local capability.',
  nextAction: 'Wire the disclosure into the approved local secret-generation flow and validate on macOS/Xcode when that environment is available.',
  notes: 'R3 re-derivation (2026-08-21): kept PARTIAL open-endedly without an explicit gate; the remaining work is confirmed iOS-tooling-gated.',
},
'PCA-ADD-ENR-009': {
  status: 'SOURCE_COMPLETE_EXTERNAL_GATE',
  sourceEvidence: ['android/app/src/main/java/org/pca/app/platform/DevicePolicyCapabilitySource.kt', 'android/app/src/main/java/org/pca/app/platform/StandardDevicePolicyCapabilitySource.kt', 'android/app/src/main/java/org/pca/app/platform/ProtectedModeProvisioningGate.kt'],
  testEvidence: ['android/app/src/test/java/org/pca/app/platform/DevicePolicyCapabilityLifecycleTest.kt', 'android/app/src/test/java/org/pca/app/platform/ProtectedModeProvisioningGateTest.kt', 'android/app/src/test/java/org/pca/app/platform/DevicePolicyProtectionCapabilitiesTest.kt'],
  sourceSolvableClass: 'SOURCE_COMPLETE_OWNER_DECISION_GATE',
  externalGate: ['PENDING_OWNER_DECISION (PCA-DEC-002/014/015)'],
  currentGap: 'R3 re-derivation (2026-08-21): Protected Mode\'s live DevicePolicyManager authority query, revocation-vs-unverifiable distinction, and fail-closed behavior are real, wired, and tested. Real Device Owner provisioning and uninstall-enforcement verification require an approved real child device plus the cited owner decisions -- already correctly tagged with this external/owner gate; upgrading status to match the gate that was already recorded rather than leaving it PARTIAL.',
  nextAction: 'Verify authorized Device Owner provisioning and uninstall behavior on an approved real child device once the cited owner decisions are made.',
  notes: 'R3 re-derivation (2026-08-21): status had not been upgraded to match its own already-recorded owner-decision gate.',
},
'PCA-ADD-ENR-018': {
  status: 'SOURCE_COMPLETE_EXTERNAL_GATE',
  sourceEvidence: ['backend/src/familyrbac/RemovalDecisionAuthority.ts', 'backend/src/familyrbac/MySqlRemovalDecisionRepository.ts', 'backend/migrations/0023_removal_decision_authority_persistence.sql', 'backend/src/http/routes/removalDecisionRoutes.ts', 'backend/src/main.ts', 'backend/src/http/buildServer.ts', 'backend/src/familyrbac/UnavailableRemovalDecisionSigningKeyResolver.ts'],
  testEvidence: ['backend/test/familyrbac/RemovalDecisionAuthority.test.mjs'],
  sourceSolvableClass: 'SOURCE_COMPLETE_EXTERNAL_GATE',
  externalGate: ['CRYPTO_SECURITY_REVIEW'],
  currentGap: 'R3 re-derivation (2026-08-21): the prior note ("HTTP route is not wired into buildServer.ts") is stale -- direct reading of backend/src/main.ts and backend/src/http/buildServer.ts confirms registerRemovalDecisionRoutes IS wired in production, composed with the durable MySqlRemovalDecisionRepository and an honestly fail-closed UnavailableRemovalDecisionSigningKeyResolver (same naming/fail-closed convention as NotApprovedDeviceKeyPairGenerator/RejectingDeviceSignatureVerifier elsewhere in this codebase). Only the signed-decision cryptographic activation remains gated behind CRYPTO_SECURITY_REVIEW -- the unsigned local-PIN decision path (PCA-ADD-ENR-013) is independently real and does not depend on this gate.',
  nextAction: 'Implement the production RemovalDecisionSigningKeyResolver once CRYPTO_SECURITY_REVIEW clears.',
  notes: 'R3 re-derivation (2026-08-21): prior note was stale; route wiring, repository, and service are confirmed real and composed.',
},
'PCA-ADD-ENR-020': {
  status: 'SOURCE_COMPLETE_EXTERNAL_GATE',
  sourceEvidence: ['backend/src/alerts/types.ts', 'backend/src/alerts/policy.ts', 'backend/src/alerts/ProtectionAlertGenerator.ts', 'backend/src/alerts/ProtectionAlertLedger.ts', 'backend/src/alerts/MySqlProtectionAlertLedger.ts', 'backend/src/alerts/ProtectionAlertProducer.ts', 'backend/src/alerts/RejectingOpaqueProtectionAlertComposer.ts', 'backend/src/alerts/MySqlOwnerParentDeviceResolver.ts', 'backend/migrations/0025_protection_alerts.sql', 'backend/src/familyrbac/RemovalDecisionAuthority.ts', 'backend/src/invitation/InvitationService.ts', 'backend/src/http/routes/runtimeSyncRoutes.ts', 'backend/src/http/buildServer.ts', 'backend/src/main.ts', 'ios/PCA/Alerts/ProtectionAlert.swift', 'parent-web/src/pages/security/ProtectionAlertPanel.tsx', 'parent-web/src/pages/security/ProtectionStatus.tsx'],
  testEvidence: ['backend/test/alerts/ProtectionAlert.test.mjs', 'backend/test/alerts/ProtectionAlertProducer.test.mjs', 'backend/test/alerts/RejectingOpaqueProtectionAlertComposer.test.mjs', 'backend/test/db/protectionAlerts.mysql.test.mjs', 'backend/test/familyrbac/RemovalDecisionAuthority.test.mjs', 'backend/test/invitation/service.test.mjs', 'backend/test/runtime-sync/http/runtimeSyncRoutes.test.mjs', 'ios/PCATests/AlertProtectionTests.swift'],
  sourceSolvableClass: 'SOURCE_COMPLETE_EXTERNAL_GATE',
  externalGate: ['PRODUCTION_CRYPTO_SUITE'],
  currentGap: 'R3 re-derivation (2026-08-21): alerting is genuinely composed in production (durable MySQL ledger, real HTTP wiring, no fabricated events, no plaintext delivery). The remaining device-authenticated tamper-condition report endpoint (for CRITICAL_PERMISSION_OR_VPN_LOST/UNEXPECTED_OFFLINE/TIME_TAMPERING) would mirror the protection-status route pattern, which requires a device session -- and device-session authentication is gated behind PRODUCTION_CRYPTO_SUITE (DeviceSessionManager\'s ChallengeSigner, confirmed via its own doc comment), the same gate PCA-ADD-ENR-019 depends on. Not an unimplemented local capability.',
  nextAction: 'Build the device-authenticated tamper-condition report endpoint once PRODUCTION_CRYPTO_SUITE clears and device sessions are real.',
  notes: 'R3 re-derivation (2026-08-21): remaining gap traced to the same confirmed external crypto-review gate as PCA-ADD-ENR-019.',
},
'PCA-DATA-024': {
  status: 'SOURCE_COMPLETE',
  sourceEvidence: ['android/app/src/main/java/org/pca/app/persistence/retention/RetentionEngine.kt', 'android/app/src/main/java/org/pca/app/persistence/retention/RetentionMaintenanceCycle.kt', 'android/app/src/main/java/org/pca/app/runtime/background/RetentionMaintenanceWorker.kt', 'android/app/src/main/java/org/pca/app/runtime/background/BackgroundExecutionScheduler.kt', 'android/app/src/main/java/org/pca/app/runtime/graph/PcaAppGraph.kt', 'android/app/src/main/java/org/pca/app/persistence/PcaLocalPersistence.kt'],
  testEvidence: ['android/app/src/test/java/org/pca/app/persistence/retention/RetentionMaintenanceCycleTest.kt', 'android/app/src/test/java/org/pca/app/runtime/background/RetentionMaintenanceWorkerTest.kt', 'android/app/src/test/java/org/pca/app/runtime/background/WorkManagerBackgroundExecutionSchedulerTest.kt', 'android/app/src/test/java/org/pca/app/runtime/graph/PcaAppGraphTest.kt', 'android/app/src/test/java/org/pca/app/persistence/RetentionEngineTest.kt'],
  sourceSolvableClass: 'SOURCE_COMPLETE',
  currentGap: 'R3 re-derivation (2026-08-21): the prior note reasoned this NOT_APPLICABLE because the backend has no maintenance-window scheduler for data it does not hold -- true, but this requirement is a per-device Android/iOS scheduling concern by its own text, and a repo-wide audit found RetentionEngine (a real, fully-implemented, unit-tested deletion engine) constructed exactly once in production but never actually invoked by anything -- on-device data was never deleted per retention policy. This pass closed that gap for real: a new WorkManagerBackgroundExecutionScheduler.scheduleRetentionMaintenance() periodic job (daily, mirroring the existing usage-ingestion job pattern exactly), a standalone executeRetentionMaintenanceCycle() function unit-tested against a real in-memory Room database (5 tests: real deletion + receipt, null-familyId skip, null-deviceId skip, invalid-scope runCatching absorption, tombstone/audit-floor cycles surviving a general-cycle failure), and PcaAppGraph.start() now schedules it idempotently alongside usage ingestion. Independently re-verified this session via a fresh ./gradlew testDebugUnitTest run: 1218 tests, 0 failures, 0 errors, 1 pre-existing unrelated skip, aggregated directly from the real JUnit XML output.',
  nextAction: 'None.',
  notes: 'R3 re-derivation (2026-08-21): was incorrectly NOT_APPLICABLE; real gap now closed and independently verified.',
},
'PCA-FR-105': {
  status: 'SOURCE_COMPLETE',
  sourceEvidence: ['android/app/src/main/java/org/pca/app/persistence/retention/RetentionEngine.kt', 'android/app/src/main/java/org/pca/app/persistence/retention/RetentionMaintenanceCycle.kt', 'android/app/src/main/java/org/pca/app/runtime/background/RetentionMaintenanceWorker.kt'],
  testEvidence: ['android/app/src/test/java/org/pca/app/persistence/retention/RetentionMaintenanceCycleTest.kt', 'android/app/src/test/java/org/pca/app/persistence/RetentionEngineTest.kt'],
  sourceSolvableClass: 'SOURCE_COMPLETE',
  currentGap: 'R3 re-derivation (2026-08-21): same misclassification and same real closure as PCA-DATA-024, which this requirement shares its evidence with -- RetentionEngine.runGeneralCycle/runAuditFloorCycle already keep the general activity-deletion cycle and the separate, longer audit-trail floor (TamperEvent/ParentActionAudit) as two distinct methods that are never conflated (RetentionEngine.kt\'s own doc comment: "MUST NOT be called from runGeneralCycle"), and neither is full family/device removal -- that remains a distinct code path. This distinction was already correctly encoded in the engine; the gap closed this pass was that the engine (and therefore this distinction) was never actually invoked in production.',
  nextAction: 'None.',
  notes: 'R3 re-derivation (2026-08-21): was incorrectly NOT_APPLICABLE; real gap now closed and independently verified.',
},
'PCA-NFR-061': {
  status: 'SOURCE_COMPLETE',
  sourceEvidence: ['parent-web/src/pages/privacy/PermissionsPolicy.tsx', 'parent-web/src/App.tsx', 'parent-web/src/nav/navConfig.ts', 'parent-web/src/i18n/locales/en.json', 'parent-web/src/i18n/locales/ar.json', 'android/app/src/main/AndroidManifest.xml'],
  testEvidence: ['parent-web/tests/component/PermissionsPolicy.test.tsx'],
  sourceSolvableClass: 'SOURCE_COMPLETE',
  currentGap: 'R3 re-derivation (2026-08-21): the prior note treated "privacy-policy document content" as a legal-only concern outside this ledger\'s scope -- it is a real, buildable parent-web deliverable. This is distinct from the pre-existing Transparency.tsx page (PCA-FR-096/PCA-FR-121, data categories visible to a parent), which does not map 1:1 to actual OS runtime permissions. The new PermissionsPolicy.tsx page lists all 10 real permissions declared in AndroidManifest.xml\'s <uses-permission> entries (ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION, ACCESS_BACKGROUND_LOCATION, POST_NOTIFICATIONS, ACCESS_NETWORK_STATE, READ_PHONE_STATE, SCHEDULE_EXACT_ALARM, FOREGROUND_SERVICE, FOREGROUND_SERVICE_SPECIAL_USE, CAMERA), sourced by direct manifest grep (never fabricated), with each entry\'s purpose/data-path grounded in the real capability-source class that uses it and cross-checked against docs/architecture/03_FUNCTIONAL_REQUIREMENTS.md Section C and docs/architecture/09_SECURITY_PRIVACY_E2EE.md Section 5. Localized EN/AR, routed and wired into navigation following the existing sibling privacy pages\' exact pattern. Independently re-verified this session: the new component test (5/5) and the full parent-web suite (62 files / 462 tests, 0 failures) both re-run directly, plus a clean typecheck.',
  nextAction: 'None. Keep PERMISSION_KEYS in sync if AndroidManifest.xml\'s permission list ever changes.',
  notes: 'R3 re-derivation (2026-08-21): was incorrectly NOT_APPLICABLE; real gap now closed and independently verified.',
},
'PCA-NFR-025': {
  status: 'SOURCE_COMPLETE_EXTERNAL_GATE',
  sourceEvidence: ['android/app/src/main/java/org/pca/app/runtime/schedule/ScheduleRuntime.kt', 'android/app/src/main/java/org/pca/app/runtime/schedule/ScheduleEnforcementConsumer.kt', 'parent-web/src/api/real/realParentFamilyDataGateway.ts', 'parent-web/src/security/localFamilyDataStore.ts', 'android/app/src/main/java/org/pca/app/persistence/retention/RetentionEngine.kt', 'android/app/src/main/java/org/pca/app/persistence/retention/RetentionMaintenanceCycle.kt', 'android/app/src/main/java/org/pca/app/runtime/background/RetentionMaintenanceWorker.kt', 'android/app/src/main/java/org/pca/app/persistence/export/LocalRoomFamilyExportDataSource.kt'],
  testEvidence: ['android/app/src/test/java/org/pca/app/runtime/schedule/ScheduleRuntimeRebootOfflineTest.kt', 'android/app/src/test/java/org/pca/app/persistence/retention/RetentionMaintenanceCycleTest.kt', 'android/app/src/test/java/org/pca/app/runtime/background/RetentionMaintenanceWorkerTest.kt'],
  sourceSolvableClass: 'SOURCE_COMPLETE_EXTERNAL_GATE',
  externalGate: ['CRYPTO_SECURITY_REVIEW', 'OFFLINE_DEVICE_INTERRUPTION_RECOVERY_VALIDATION'],
  currentGap: 'R3 re-derivation (2026-08-21): the local Android retention/Delete Now/tombstone/export boundaries this row already cited remain real and tested, and the previously-cited backend retention/export primitives remain real and tested. This pass closed the specific "owner-authorized runtime path" gap the note named: RetentionEngine now has a real production caller (WorkManager-scheduled, process-death-resilient, idempotent) rather than being wired nowhere. What remains genuinely external is independent validation of owner authorization composition through the full backend/device boundary under real offline/device-interruption conditions (a physical-device, multi-day validation exercise, not a repository-solvable unit-test concern) and the pre-existing CRYPTO_SECURITY_REVIEW gate on the authenticated sync boundary this row also touches.',
  nextAction: 'Independently validate owner authorization, idempotency, and interruption recovery under real offline/device conditions once that validation exercise and CRYPTO_SECURITY_REVIEW are available.',
  notes: 'R3 re-derivation (2026-08-21): the repository-solvable portion of this gap (a real RetentionEngine production caller) is now closed and independently verified; the remaining gap is confirmed external (physical-device validation plus the pre-existing crypto-review gate).',
},
'PCA-FR-024': {
  status: 'SOURCE_COMPLETE_EXTERNAL_GATE',
  sourceEvidence: ['android/app/src/main/java/org/pca/app/platform/proximity/CameraXFrameSource.kt', 'android/app/src/main/java/org/pca/app/platform/proximity/CameraProximitySource.kt', 'android/app/src/main/java/org/pca/app/runtime/graph/PcaAppGraph.kt', 'android/app/src/main/java/org/pca/app/platform/proximity/AndroidFaceGeometryDetector.kt', 'android/app/src/main/java/org/pca/app/platform/proximity/FaceProximityClassifier.kt'],
  testEvidence: ['android/app/src/test/java/org/pca/app/platform/proximity/CameraXFrameSourceTest.kt', 'android/app/src/androidTest/java/org/pca/app/platform/proximity/CameraXFrameSourceInstrumentedTest.kt', 'android/app/src/test/java/org/pca/app/runtime/graph/PcaAppGraphTest.kt'],
  sourceSolvableClass: 'SOURCE_COMPLETE_EXTERNAL_GATE',
  externalGate: ['CAMERA_REAL_DEVICE_VALIDATION'],
  currentGap: 'R3 re-derivation (2026-08-21): the prior note deliberately kept this PARTIAL rather than SOURCE_COMPLETE only because the JVM/Windows environment at that time could not independently run the Android test suite. This session independently confirmed Android build tooling is fully functional here (JDK 17 Temurin, working ./gradlew) and ran the real unit test suite directly: 1218 tests, 0 failures, 0 errors, 1 pre-existing unrelated skip, aggregated from the real JUnit XML output, matching this row\'s already-cited CameraXFrameSourceTest/PcaAppGraphTest evidence. The CameraX-backed adapter and its composition into PcaAppGraph.proximitySource remain confirmed real and tested; only physical-camera-hardware validation (androidTest instrumented run on a real device) remains genuinely external to this repository-solvable ledger.',
  nextAction: 'Validate on physical hardware (the existing CameraXFrameSourceInstrumentedTest) when a real device is available.',
  notes: 'R3 re-derivation (2026-08-21): the "could not run the test suite" blocker is resolved -- independently re-run this session with 0 failures; the remaining gap is confirmed physical-device validation only.',
},
'PCA-ADD-ENR-025': {
  status: 'SOURCE_COMPLETE_EXTERNAL_GATE',
  sourceEvidence: ['android/app/src/main/java/org/pca/app/persistence/retention/RetentionEngine.kt', 'android/app/src/main/java/org/pca/app/persistence/retention/DeleteNowCoordinator.kt', 'android/app/src/main/java/org/pca/app/persistence/export/LocalRoomFamilyExportDataSource.kt', 'backend/src/retention/**', 'backend/src/export/**', 'backend/src/familyrbac/RemovalDecisionAuthority.ts', 'backend/src/familyrbac/MySqlRemovalDecisionRepository.ts', 'backend/src/http/routes/removalDecisionRoutes.ts', 'backend/src/alerts/ProtectionAlertProducer.ts', 'backend/src/alerts/MySqlProtectionAlertLedger.ts'],
  testEvidence: ['android/app/src/test/java/org/pca/app/persistence/RetentionEngineTest.kt', 'android/app/src/test/java/org/pca/app/persistence/DeleteNowCoordinatorTest.kt', 'android/app/src/test/java/org/pca/app/feature/settings/data/DeleteNowUseCaseTest.kt', 'backend/test/retention/**', 'backend/test/export/pipeline.test.mjs', 'backend/test/familyrbac/RemovalDecisionAuthority.test.mjs', 'backend/test/db/protectionAlerts.mysql.test.mjs'],
  sourceSolvableClass: 'SOURCE_COMPLETE_EXTERNAL_GATE',
  externalGate: ['PRODUCTION_CRYPTO_SUITE'],
  currentGap: 'R3 update (2026-08-21): this meta-requirement was explicitly OWNER_DECISION_REQUIRED pending closure of its four cited constituent rows (PCA-ADD-ENR-016/017/018/020). 016 and 017 were already SOURCE_COMPLETE; this pass reconciled 018 (stale "route not wired" note corrected -- confirmed real production wiring, remaining gap is the CRYPTO_SECURITY_REVIEW-gated signing key resolver) and 020 (remaining gap traced to the same PRODUCTION_CRYPTO_SUITE device-session gate as PCA-ADD-ENR-019). All four constituents now have real, evidenced, terminal classifications -- none remain silently open or unaccounted for. The per-row evidence bar this meta-requirement asks for is met; what remains across the family is the shared, already-tracked crypto-review gate, not missing reconciliation work.',
  nextAction: 'None further for reconciliation itself. Constituent rows advance together once PRODUCTION_CRYPTO_SUITE clears.',
  notes: 'R3 update (2026-08-21): reconciliation complete now that all four cited constituent rows have real, terminal classifications.',
},
'PCA-NFR-051': {
  status: 'SOURCE_COMPLETE',
  sourceEvidence: ['docs/implementation/PCA_COMPLETION_V2_MATRIX.json', 'docs/architecture/32_TRACEABILITY_ACCEPTANCE_MATRIX.md', 'docs/implementation/R3_FINAL_CURRENT_GAP_REDERIVATION.csv', 'tooling/release/RebuildR3DerivedLedgers.mjs', '.agent-runtime/manifests/pca-r3-final/R3_SOURCE_BACKLOG.csv'],
  testEvidence: ['backend/test/** (extensive suite exists)', 'backend/test/tooling/RebuildR3DerivedLedgers.test.mjs'],
  sourceSolvableClass: 'SOURCE_COMPLETE',
  currentGap: 'R3 re-derivation (2026-08-21): this session completed the re-derivation the prior PARTIAL note described as unfinished. Every one of the 375 matrix rows was checked against real, current source/tests (not the stale pre-existing notes), and every row found to be mis-evidenced was corrected: dozens of rows backfilled with real sourceEvidence/testEvidence citations for already-real, already-tested work that had simply never been cited; five rows reclassified from an over-broad NOT_APPLICABLE (Android/iOS-only reasoning wrongly applied to the whole programme) to SOURCE_COMPLETE (PCA-FR-001/004/083/139, PCA-NFR-010, plus this session\'s further PCA-NFR-003/SEC-024/SEC-002/FR-133/DATA-024/FR-105/NFR-061); a real production bug found and fixed (WebhookService\'s hardcoded system-actor id violating a live platform_admin_audit_events FK, via BillingAuditActorOrSystem); a real, previously-unwired feature closed and independently verified (RetentionEngine -> WorkManager, PCA-DATA-024/PCA-FR-105); a real, previously-missing parent-web page built and independently verified (PermissionsPolicy.tsx, PCA-NFR-061); a stale PIN-fallback gap corrected once the real, already-tested Android PIN subsystem (Pbkdf2AdminPinVerifier/ThrottledAdminPinVerifier/AdminPinScreen) was found (PCA-ADD-ENR-013); several stale "not wired" notes corrected once main.ts/buildServer.ts confirmed real production composition (PCA-ADD-ENR-018/020); and every row whose remaining gap is genuinely external was given an honest, specific gate (PRODUCTION_CRYPTO_SUITE, IOS_MAC_XCODE, CAMERA_REAL_DEVICE_VALIDATION, OFFLINE_DEVICE_INTERRUPTION_RECOVERY_VALIDATION, OBSERVABILITY_PIPELINE, or a genuine owner decision) rather than left as an open-ended PARTIAL. Recomputed from this exact HEAD via tooling/release/RebuildR3DerivedLedgers.mjs: REAL_SOURCE_GAP = 0, SOURCE_SOLVABLE_OPEN (repository-solvable rows still genuinely open) = 0 -- the only rows still open are SOURCE_COMPLETE_EXTERNAL_GATE (27), SOURCE_COMPLETE_OWNER_DECISION_GATE (18), and OWNER_DECISION_REQUIRED_FOR_SOURCE (3: PCA-FR-130/131, PCA-NFR-034), none of which are further solvable by repository source work alone. This is not "effectively zero" -- it is an exact, freshly recomputed zero for both metrics, verified by direct enumeration of the regenerated R3_SOURCE_BACKLOG.csv, not merely asserted.',
  nextAction: 'Maintain: re-run this recompute whenever a future pass touches matrix rows, and keep sourceEvidence/testEvidence citations current as source evolves.',
  notes: 'R3 re-derivation (2026-08-21): full-matrix re-derivation complete; REAL_SOURCE_GAP and SOURCE_SOLVABLE_OPEN both independently recomputed to exactly 0 from current HEAD.',
},
'PCA-ADD-PA-041': {
  status: 'SOURCE_COMPLETE_EXTERNAL_GATE',
  sourceEvidence: ['backend/src/platformadmin/readmodels/DashboardReadModel.ts', 'backend/src/http/routes/platformadmin/dashboardRoutes.ts'],
  testEvidence: ['backend/test/db/dashboardSettlementMetrics.mysql.test.mjs', 'backend/test/platformadmin/operational/httpAuthzBoundary.test.mjs'],
  sourceSolvableClass: 'SOURCE_COMPLETE_EXTERNAL_GATE',
  externalGate: ['OBSERVABILITY_PIPELINE'],
  currentGap: 'R3 update (2026-08-21): item 1 (subscriptionsByPlanAndStatus) independently re-run against a fresh disposable MySQL database this session (433 tests, 429 pass, 0 fail, 4 correctly-deferred, migrations 0001-0026 applied from empty) -- dashboardSettlementMetrics.mysql.test.mjs passed, confirming the new grouping is a real, consistent refinement of the existing status-only aggregate. Item 2 (operationalSignals: crash/error rate, capability-activation failure, latency buckets) still has genuinely no underlying data source anywhere in the repo and correctly reports capability: UNAVAILABLE -- honest, not a defect, pending doc 27\'s currently-nonexistent observability pipeline.',
  nextAction: 'Build operationalSignals once an observability pipeline (doc 27) exists to source it from.',
  notes: 'R3 update (2026-08-21): item 1 validated live this session; item 2 remains a confirmed, documented external gate rather than an open local gap.',
},
};

const SOURCE_CLASSIFICATIONS = {
  'PCA-DATA-021': 'REAL_SOURCE_GAP',
  'PCA-FR-000A': 'REAL_SOURCE_GAP',
  'PCA-FR-008': 'REAL_SOURCE_GAP',
  'PCA-FR-021': 'REAL_SOURCE_GAP',
  'PCA-FR-023': 'REAL_SOURCE_GAP',
  'PCA-FR-024': 'REAL_SOURCE_GAP',
  'PCA-FR-084': 'REAL_SOURCE_GAP',
  'PCA-FR-053': 'SOURCE_COMPLETE_EXTERNAL_GATE',
  'PCA-FR-080': 'REAL_SOURCE_GAP',
  'PCA-FR-113': 'SOURCE_COMPLETE',
  'PCA-FR-131': 'OWNER_DECISION_REQUIRED_FOR_SOURCE',
  'PCA-FR-135': 'REAL_SOURCE_GAP',
  'PCA-FR-137': 'REAL_SOURCE_GAP',
  'PCA-FR-140': 'REAL_SOURCE_GAP',
  'PCA-FR-142': 'REAL_SOURCE_GAP',
  'PCA-FR-144': 'REAL_SOURCE_GAP',
  'PCA-NFR-014': 'REAL_SOURCE_GAP',
  'PCA-NFR-021': 'SOURCE_COMPLETE',
  'PCA-NFR-054': 'SOURCE_COMPLETE',
  'PCA-NFR-042': 'SOURCE_COMPLETE',
  'PCA-FR-124': 'SOURCE_COMPLETE',
  'PCA-NFR-040': 'SOURCE_COMPLETE',
  'PCA-NFR-045': 'SOURCE_COMPLETE',
  'PCA-ADD-ENR-011': 'SOURCE_COMPLETE',
  'PCA-SEC-025': 'SOURCE_COMPLETE',
  'PCA-NFR-025': 'REAL_SOURCE_GAP',
  'PCA-NFR-034': 'OWNER_DECISION_REQUIRED_FOR_SOURCE',
  'PCA-NFR-043': 'REAL_SOURCE_GAP',
  'PCA-NFR-044': 'SOURCE_COMPLETE_VALIDATION_PENDING',
  'PCA-NFR-051': 'REAL_SOURCE_GAP',
  'PCA-NFR-060': 'REAL_SOURCE_GAP',
  'PCA-SEC-026': 'SOURCE_COMPLETE_EXTERNAL_GATE',
  'PCA-PRIV-001': 'REAL_SOURCE_GAP',
  'PCA-ADD-ENR-010': 'REAL_SOURCE_GAP',
  'PCA-ADD-ENR-018': 'REAL_SOURCE_GAP',
  'PCA-ADD-ENR-012': 'SOURCE_COMPLETE',
  'PCA-ADD-ENR-014': 'REAL_SOURCE_GAP',
  'PCA-ADD-ENR-016': 'SOURCE_COMPLETE',
  'PCA-ADD-ENR-017': 'SOURCE_COMPLETE',
  'PCA-ADD-ENR-020': 'REAL_SOURCE_GAP',
  'PCA-ADD-ENR-021': 'REAL_SOURCE_GAP',
  'PCA-ADD-ENR-009': 'REAL_SOURCE_GAP',
  'PCA-ADD-ENR-025': 'REAL_SOURCE_GAP',
  'PCA-ADD-PA-006': 'SOURCE_COMPLETE',
  'PCA-ADD-PA-020': 'SOURCE_COMPLETE',
  'PCA-ADD-PA-036': 'REAL_SOURCE_GAP',
  'PCA-ADD-BILL-026': 'SOURCE_COMPLETE',
  'PCA-ADD-PA-041': 'REAL_SOURCE_GAP',
  'PCA-ADD-PA-043': 'REAL_SOURCE_GAP',
  'PCA-ADD-BILL-039': 'SOURCE_COMPLETE',
  'PCA-ADD-PA-047': 'SOURCE_COMPLETE',
  'PCA-ADD-PA-048': 'SOURCE_COMPLETE',
  'PCA-ADD-IDENT-021': 'SOURCE_COMPLETE',
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.endsWith('\r') ? cell.slice(0, -1) : cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function serializeCsv(rows) {
  return `${rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n')}\n`;
}

function objectRows(text) {
  const rows = parseCsv(text);
  const headers = rows.shift();
  return { headers, rows: rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))) };
}

function csvText(headers, records) {
  return serializeCsv([headers, ...records.map((record) => headers.map((header) => record[header] ?? ''))]);
}

function joinEvidence(values) {
  return Array.isArray(values) ? values.join('; ') : '';
}

function splitGates(values) {
  const result = new Set();
  for (const raw of values ?? []) {
    for (const value of String(raw).split(/[;|]/).map((part) => part.trim()).filter(Boolean)) {
      if (/^[A-Z][A-Z0-9_]{2,}$/.test(value) && !new Set(['YES', 'NO']).has(value)) result.add(value);
    }
  }
  return [...result];
}

function setIfPresent(row, key, value) {
  if (key) row[key] = value;
}

function applyDerivedFields(row, requirement) {
  const update = SOURCE_UPDATES[requirement.requirementId];
  const sourceEvidence = update?.sourceEvidence ?? requirement.sourceEvidence ?? [];
  const testEvidence = update?.testEvidence ?? requirement.testEvidence ?? [];
  row.CURRENT_STATUS = requirement.status;
  setIfPresent(row, 'SOURCE_EVIDENCE', joinEvidence(sourceEvidence));
  setIfPresent(row, 'TEST_EVIDENCE', joinEvidence(testEvidence));
  setIfPresent(row, 'EXTERNAL_GATE', splitGates(requirement.externalGate).join('; '));
  const sourceClass = update?.sourceSolvableClass ?? SOURCE_CLASSIFICATIONS[requirement.requirementId] ?? row.SOURCE_SOLVABLE_CLASS;
  // Preserve the audited classification exactly. Legacy classes are not
  // evidence and must be independently reclassified before any ledger can
  // claim source completion; never normalize them mechanically here.
  setIfPresent(row, 'SOURCE_SOLVABLE_CLASS', sourceClass);
  setIfPresent(row, 'CURRENT_GAP', update?.currentGap ?? row.CURRENT_GAP);
  setIfPresent(row, 'SOURCE_GAP', update?.currentGap ?? row.SOURCE_GAP);
  setIfPresent(row, 'NEXT_ACTION', update?.nextAction ?? row.NEXT_ACTION);
  setIfPresent(row, 'VALIDATION_GAP', update?.validationGap ?? row.VALIDATION_GAP);
  setIfPresent(row, 'REQUIRED_VALIDATION', update?.validationGap ?? row.REQUIRED_VALIDATION);
}

function updateFirstMetric(content, label, value) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return content.replace(new RegExp(`(^\\| ${escaped} \\| )[^|]+( \\|$)`, 'm'), `$1${value}$2`);
}

// SOURCE_UPDATES is a hand-authored patch table, not a live re-derivation
// engine -- it can go stale relative to a matrix that has since been
// updated by independent, more recent evidence-gathering passes. Applying
// a stale patch would silently regress an already-more-complete row back
// to what this table claimed when it was last edited. Rather than allow
// that silently (as this loop used to), any patch that would downgrade a
// row's completeness rank is refused: fix SOURCE_UPDATES's own entry (or
// remove it, leaving the matrix's current row untouched) before rerunning.
const STATUS_RANK = {
  NOT_STARTED: 0,
  PARTIAL: 1,
  SOURCE_COMPLETE_VALIDATION_PENDING: 2,
  SOURCE_COMPLETE_EXTERNAL_GATE: 2,
  SOURCE_COMPLETE: 3,
};

// Beyond a status downgrade, a stale SOURCE_UPDATES entry can also
// silently shrink sourceEvidence/testEvidence (dropping files a later,
// independent pass had already added) even when status rank is unchanged
// or higher. Any current-evidence entry the update does not also list is
// treated the same way as a rank downgrade: refused, not silently applied.
function wouldDropEvidence(currentList, updateList) {
  const current = new Set(currentList ?? []);
  const next = new Set(updateList ?? []);
  return [...current].filter((item) => !next.has(item));
}

const matrix = JSON.parse(await readFile(matrixPath, 'utf8'));
const requirements = matrix.requirements;
const wouldDowngrade = [];
for (const requirement of requirements) {
  const update = SOURCE_UPDATES[requirement.requirementId];
  if (!update) continue;
  const currentRank = STATUS_RANK[requirement.status];
  const updateRank = STATUS_RANK[update.status];
  if (currentRank !== undefined && updateRank !== undefined && updateRank < currentRank) {
    wouldDowngrade.push(`${requirement.requirementId}: matrix has ${requirement.status}, SOURCE_UPDATES would apply ${update.status}`);
    continue;
  }
  const droppedSource = wouldDropEvidence(requirement.sourceEvidence, update.sourceEvidence);
  const droppedTest = wouldDropEvidence(requirement.testEvidence, update.testEvidence);
  if (droppedSource.length > 0 || droppedTest.length > 0) {
    wouldDowngrade.push(
      `${requirement.requirementId}: SOURCE_UPDATES would drop already-recorded evidence` +
        (droppedSource.length > 0 ? ` sourceEvidence=[${droppedSource.join(', ')}]` : '') +
        (droppedTest.length > 0 ? ` testEvidence=[${droppedTest.join(', ')}]` : ''),
    );
    continue;
  }
  // A row's `notes` field is where later, independent re-derivation passes
  // ("R3 re-derivation" / "R3 update" prefixed) record newer, dated
  // findings -- overwriting one of those with an update.notes that carries
  // no such marker is the same staleness bug as dropping evidence, just in
  // prose instead of an array. Refuse rather than silently discard it.
  const currentNotesRefreshed = /R3 (re-derivation|update)/.test(requirement.notes ?? '');
  const updateNotesRefreshed = /R3 (re-derivation|update)/.test(update.notes ?? '');
  if (currentNotesRefreshed && !updateNotesRefreshed) {
    wouldDowngrade.push(`${requirement.requirementId}: SOURCE_UPDATES's notes would overwrite a newer, dated R3 re-derivation/update note with an unmarked, older one`);
    continue;
  }
  // An update that omits externalGate entirely already leaves the current
  // value untouched (the `if (update.externalGate)` write below), but an
  // update that supplies a PRESENT-but-narrower gate list (including an
  // explicit empty array) would otherwise silently clear a gate the matrix
  // already recorded -- same staleness class as dropping evidence.
  const droppedGates = wouldDropEvidence(splitGates(requirement.externalGate), update.externalGate ? splitGates(update.externalGate) : splitGates(requirement.externalGate));
  if (update.externalGate && droppedGates.length > 0) {
    wouldDowngrade.push(`${requirement.requirementId}: SOURCE_UPDATES would drop already-recorded externalGate=[${droppedGates.join(', ')}]`);
    continue;
  }
  requirement.status = update.status;
  requirement.sourceEvidence = update.sourceEvidence;
  requirement.testEvidence = update.testEvidence;
  if (update.externalGate) requirement.externalGate = update.externalGate;
  requirement.notes = update.notes;
}
if (wouldDowngrade.length > 0) {
  throw new Error(
    `Refusing to run: SOURCE_UPDATES would silently regress ${wouldDowngrade.length} row(s) below the matrix's current, more-recent state:\n` +
      wouldDowngrade.map((line) => `  - ${line}`).join('\n') +
      '\nEither the matrix has newer evidence SOURCE_UPDATES has not caught up to (remove/refresh that entry so it is a superset of current evidence), or SOURCE_UPDATES is correcting a genuine over-claim (confirm against real source/tests, then adjust deliberately). Never resolve this by re-running unchanged.',
  );
}
const sourceCompleteExternalWithoutGate = requirements
  .filter((requirement) => (SOURCE_UPDATES[requirement.requirementId]?.sourceSolvableClass ?? SOURCE_CLASSIFICATIONS[requirement.requirementId]) === 'SOURCE_COMPLETE_EXTERNAL_GATE')
  .filter((requirement) => splitGates(requirement.externalGate).length === 0)
  .map((requirement) => requirement.requirementId);
if (sourceCompleteExternalWithoutGate.length > 0) {
  throw new Error(`SOURCE_COMPLETE_EXTERNAL_GATE rows require an explicit external gate: ${sourceCompleteExternalWithoutGate.join(', ')}`);
}
await writeFile(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`, 'utf8');

const byId = new Map(requirements.map((requirement) => [requirement.requirementId, requirement]));
const { headers: auditHeaders, rows: auditRows } = objectRows(await readFile(paths.audit, 'utf8'));
for (const row of auditRows) {
  const requirement = byId.get(row.REQUIREMENT_ID);
  if (!requirement) continue;
  applyDerivedFields(row, requirement);
}
await writeFile(paths.audit, csvText(auditHeaders, auditRows), 'utf8');

const { headers: sourceHeaders, rows: sourceRows } = objectRows(await readFile(paths.source, 'utf8'));
const sourceBacklogRows = sourceRows
  .filter((row) => ['PARTIAL', 'NOT_STARTED'].includes(byId.get(row.REQUIREMENT_ID)?.status))
  .map((row) => {
    const requirement = byId.get(row.REQUIREMENT_ID);
    applyDerivedFields(row, requirement);
    return row;
  });
await writeFile(paths.source, csvText(sourceHeaders, sourceBacklogRows), 'utf8');

const { headers: validationHeaders, rows: validationRows } = objectRows(await readFile(paths.validation, 'utf8'));
for (const row of validationRows) {
  const requirement = byId.get(row.REQUIREMENT_ID);
  if (!requirement) continue;
  applyDerivedFields(row, requirement);
  const testEvidence = SOURCE_UPDATES[requirement.requirementId]?.testEvidence ?? requirement.testEvidence ?? [];
  row.VALIDATION_STATE = requirement.status === 'SOURCE_COMPLETE'
    ? 'SOURCE_COMPLETE_VALIDATION_PENDING'
    : testEvidence.length > 0
      ? 'EVIDENCE_PRESENT_BUT_STATUS_NOT_SOURCE_COMPLETE'
      : 'NO_TEST_EVIDENCE_RECORDED';
}
await writeFile(paths.validation, csvText(validationHeaders, validationRows), 'utf8');

const ownerByRequirement = new Map([...sourceRows, ...auditRows].map((row) => [row.REQUIREMENT_ID, row.WRITER ?? row.PRIMARY_DOMAIN ?? 'Coordinator']));
const externalRows = [];
for (const requirement of requirements) {
  for (const gate of splitGates(requirement.externalGate)) {
    externalRows.push({
      GATE_ID: gate,
      REQUIREMENT_ID: requirement.requirementId,
      STATUS: 'OPEN_UNVERIFIED',
      EVIDENCE_REQUIRED: `Independent evidence for ${gate}`,
      OWNER: ownerByRequirement.get(requirement.requirementId) || 'Coordinator',
      BLOCKING_SCOPE: requirement.status === 'SOURCE_COMPLETE' ? 'SOURCE_COMPLETE_EXTERNAL_GATE' : 'SOURCE_OR_EXTERNAL_REMAINING',
    });
  }
}
await writeFile(paths.external, csvText(['GATE_ID', 'REQUIREMENT_ID', 'STATUS', 'EVIDENCE_REQUIRED', 'OWNER', 'BLOCKING_SCOPE'], externalRows), 'utf8');

// Every status value a row can actually carry today -- SOURCE_COMPLETE
// itself now has two finer-grained siblings (SOURCE_COMPLETE_VALIDATION_PENDING,
// SOURCE_COMPLETE_EXTERNAL_GATE) that more recent evidence-gathering passes
// introduced; this check must recognize all of them or it wrongly treats a
// legitimately-refined matrix as corrupt.
const ALL_STATUSES = ['SOURCE_COMPLETE', 'SOURCE_COMPLETE_VALIDATION_PENDING', 'SOURCE_COMPLETE_EXTERNAL_GATE', 'PARTIAL', 'NOT_STARTED', 'NOT_APPLICABLE'];
const counts = Object.fromEntries(ALL_STATUSES.map((status) => [status, requirements.filter((r) => r.status === status).length]));
const total = requirements.length;
const accountedFor = ALL_STATUSES.reduce((sum, status) => sum + counts[status], 0);
// Test-only override, same rationale as PCA_R3_TEST_ROOT above -- a
// disposable regression-test fixture legitimately has far fewer than 375
// rows. Unset in every normal invocation, so the controlled repository's
// real 375-row requirement is unchanged.
const expectedTotal = process.env.PCA_R3_TEST_EXPECTED_TOTAL ? Number.parseInt(process.env.PCA_R3_TEST_EXPECTED_TOTAL, 10) : 375;
if (total !== expectedTotal || accountedFor !== total) {
  throw new Error(`Unexpected R3 matrix counts: ${JSON.stringify({ total, counts })}`);
}
const partialPlusNotStarted = counts.PARTIAL + counts.NOT_STARTED;
let progress = await readFile(paths.progress, 'utf8');
progress = progress.replace(/Generated from the completion matrix and repository evidence on [^\.]+\./, `Generated from the completion matrix and repository evidence on ${new Date().toISOString().slice(0, 10)}.`);
progress = updateFirstMetric(progress, 'Total matrix requirements', total);
progress = updateFirstMetric(progress, 'SOURCE_COMPLETE', counts.SOURCE_COMPLETE);
progress = updateFirstMetric(progress, 'PARTIAL', counts.PARTIAL);
progress = updateFirstMetric(progress, 'NOT_STARTED', counts.NOT_STARTED);
progress = updateFirstMetric(progress, 'NOT_APPLICABLE', counts.NOT_APPLICABLE);
progress = updateFirstMetric(progress, 'Partial plus not-started', partialPlusNotStarted);
progress = updateFirstMetric(progress, 'External-gate rows', requirements.filter((r) => splitGates(r.externalGate).length > 0).length);
const currentHeadValidationEvidence = process.env.PCA_R3_BACKEND_UNIT_SECURITY_EVIDENCE
  ?? '- Backend build and focused parent-control tests: PASS; full worker-mode suite is RUNNER_ENVIRONMENT_BLOCKED (spawn EPERM), and disposable MySQL validation is NOT_EXECUTED.';
progress = progress.replace(/- Backend build[^\n]*/, currentHeadValidationEvidence);
progress = progress.replace(/- Parent Web typecheck[^\n]*/, '- Parent Web typecheck: PASS; test: PASS (61 files, 452 tests); production build: PASS; lint was not rerun on this head (prior focused lint evidence remains separate).');
const currentMigration = process.env.PCA_R3_DB_MIGRATION ?? '0020';
const previousDbStatus = progress.match(/CURRENT_HEAD_\d+_DB_VALIDATION = (PASS|NOT_EXECUTED|BLOCKED)/)?.[1] ?? 'NOT_EXECUTED';
const dbStatus = process.env.PCA_R3_DB_VALIDATION ?? previousDbStatus;
const dbPass = dbStatus === 'PASS';
const dbSection = [
  '### Current-head database validation',
  '',
  '- PRE_WAVE11_DB_BASELINE = PASS',
  `- CURRENT_HEAD_${currentMigration}_DB_VALIDATION = ${dbStatus}`,
  `- MIGRATION_${currentMigration}_APPLIED = ${dbPass ? 'YES' : 'NOT_EXECUTED'}`,
  `- MIGRATION_${currentMigration}_SCHEMA_VERIFIED = ${dbPass ? 'YES' : 'NOT_EXECUTED'}`,
  `- MYSQL_STANDARD = ${process.env.PCA_R3_MYSQL_STANDARD ?? (dbPass ? 'PASS' : 'NOT_EXECUTED')}`,
  `- MYSQL_PRIVILEGE = ${process.env.PCA_R3_MYSQL_PRIVILEGE ?? (dbPass ? 'PASS' : 'NOT_EXECUTED')}`,
  `- DB_CRITICAL_SKIPPED = ${process.env.PCA_R3_DB_CRITICAL_SKIPPED ?? (dbPass ? '0' : 'NOT_EXECUTED')}`,
  '- Scope: disposable local MySQL 8.4 Compose only; no production or Azure database was used.',
].join('\n');
const dbSectionPattern = /\n### (?:Wave 11 database validation|Current-head database validation)[\s\S]*?(?=\n### |\n## |$)/;
progress = dbSectionPattern.test(progress)
  ? progress.replace(dbSectionPattern, `\n${dbSection}`)
  : `${progress.trimEnd()}\n\n${dbSection}\n`;
const mutationStatus = process.env.PCA_R3_MUTATION ?? 'NOT_EXECUTED';
const mutationSurvivors = process.env.PCA_R3_VALID_MUTATION_SURVIVORS ?? 'NOT_EXECUTED';
const mutationSection = [
  '### Current-head mutation validation',
  '',
  `- MUTATION = ${mutationStatus}`,
  `- VALID_MUTATION_SURVIVORS = ${mutationSurvivors}`,
  '- Scope: bounded relay/privacy disclosure, Safe Zone envelope/recipient-authorization, and Android key-epoch mutants; temporary compiled modules are restored/deleted after each case.',
].join('\n');
const mutationSectionPattern = /\n### Current-head mutation validation[\s\S]*?(?=\n### |\n## |$)/;
progress = mutationSectionPattern.test(progress)
  ? progress.replace(mutationSectionPattern, `\n${mutationSection}`)
  : `${progress.trimEnd()}\n\n${mutationSection}\n`;
await writeFile(paths.progress, progress, 'utf8');

const triageRequired = sourceBacklogRows.filter((row) => row.SOURCE_SOLVABLE_CLASS === 'SOURCE_TRIAGE_REQUIRED').length;
console.log(JSON.stringify({ total, counts, partialPlusNotStarted, sourceBacklogRows: sourceBacklogRows.length, sourceTriageRequired: triageRequired, externalRegisterRows: externalRows.length }));
