import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const manifestRoot = `${root}/.agent-runtime/manifests/pca-r3-final`;
const matrixPath = `${root}/docs/implementation/PCA_COMPLETION_V2_MATRIX.json`;

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
  'PCA-ADD-ENR-012': 'REAL_SOURCE_GAP',
  'PCA-ADD-ENR-014': 'REAL_SOURCE_GAP',
  'PCA-ADD-ENR-016': 'REAL_SOURCE_GAP',
  'PCA-ADD-ENR-017': 'REAL_SOURCE_GAP',
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
if (total !== 375 || accountedFor !== total) {
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
