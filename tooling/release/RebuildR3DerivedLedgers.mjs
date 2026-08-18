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
  'PCA-FR-063': {
    status: 'PARTIAL',
    sourceEvidence: [
      'android/app/src/main/java/org/pca/app/runtime/location/geofence/GeofenceEngine.kt',
      'android/app/src/main/java/org/pca/app/runtime/location/geofence/GeofenceMonitor.kt',
      'backend/src/location/SafeZoneRepository.ts',
      'backend/src/location/MySqlSafeZoneRepository.ts',
      'backend/src/http/routes/parentAccountRoutes.ts',
      'backend/src/location/SafeZonePolicyAuthorization.ts',
      'backend/src/familyrbac/ParentActionAuthorizationService.ts',
      'backend/src/familyrbac/UnavailableTrustSetRoleResolver.ts',
      'backend/src/http/buildServer.ts',
      'backend/src/main.ts',
      'parent-web/src/pages/children/LocationPage.tsx',
      'parent-web/src/api/real/realSafeZoneClient.ts',
      'backend/migrations/0020_parent_preferences_safe_zones.sql',
    ],
    testEvidence: ['android/app/src/test/java/org/pca/app/runtime/location/geofence/GeofenceEngineTest.kt', 'backend/test/parentaccount/preferencesSafeZonesRoute.test.mjs', 'backend/test/parentaccount/preferencesSafeZonesSchema.test.mjs', 'backend/test/familyrbac/ParentActionAuthorizationService.test.mjs', 'tooling/release/ValidateSafeZoneMutationBoundary.mjs'],
    sourceSolvableClass: 'REAL_SOURCE_GAP',
    currentGap: 'The previous implementation exposed readable location policy and lacked a server-reachable family-role authority. The corrected source stores only encrypted envelopes and fails closed until the verified Owner/Administrator/Viewer authority is wired.',
    validationGap: 'Focused route behavior passes in-process; Node worker mode is blocked by environment spawn EPERM, and disposable MySQL plus Android device delivery validation remain unexecuted.',
    nextAction: 'Wire the verified family trust-set role authority, then validate encrypted delivery and device application.',
    notes: 'Safe zones now store only opaque recipient routing metadata and encrypted policy bytes. No central readable location policy or movement history is introduced.',
  },
  'PCA-FR-091': {
    status: 'PARTIAL',
    sourceEvidence: ['parent-web/src/pages/children/LocationPage.tsx', 'parent-web/src/api/interfaces.ts', 'parent-web/src/api/safeZonePolicyAuthoring.ts', 'parent-web/src/api/client.ts', 'parent-web/src/api/real/realSafeZoneClient.ts', 'backend/src/http/routes/parentAccountRoutes.ts', 'backend/src/location/SafeZonePolicyAuthorization.ts'],
    testEvidence: ['backend/test/parentaccount/preferencesSafeZonesRoute.test.mjs'],
    sourceSolvableClass: 'REAL_SOURCE_GAP',
    currentGap: 'Parent Web is intentionally fail-closed because no trusted local encryption and family-role authority path is available yet; plaintext safe-zone authoring was removed.',
    validationGap: 'Parent Web typecheck passes and focused route behavior passes in-process; browser axe/RTL journey and live MySQL validation remain pending.',
    nextAction: 'Bind the trusted browser envelope authoring path and verified family-role authority before reopening controls.',
    notes: 'The UI never collects or renders readable location policy until the encrypted family-policy boundary exists.',
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
};

const SOURCE_CLASSIFICATIONS = {
  'PCA-DATA-021': 'REAL_SOURCE_GAP',
  'PCA-FR-000A': 'REAL_SOURCE_GAP',
  'PCA-FR-008': 'REAL_SOURCE_GAP',
  'PCA-FR-021': 'REAL_SOURCE_GAP',
  'PCA-FR-023': 'REAL_SOURCE_GAP',
  'PCA-FR-024': 'REAL_SOURCE_GAP',
  'PCA-FR-084': 'REAL_SOURCE_GAP',
  'PCA-FR-053': 'REAL_SOURCE_GAP',
  'PCA-FR-080': 'REAL_SOURCE_GAP',
  'PCA-FR-113': 'REAL_SOURCE_GAP',
  'PCA-FR-114': 'REAL_SOURCE_GAP',
  'PCA-FR-124': 'REAL_SOURCE_GAP',
  'PCA-FR-127': 'REAL_SOURCE_GAP',
  'PCA-FR-131': 'OWNER_DECISION_REQUIRED_FOR_SOURCE',
  'PCA-FR-135': 'REAL_SOURCE_GAP',
  'PCA-FR-137': 'REAL_SOURCE_GAP',
  'PCA-FR-140': 'REAL_SOURCE_GAP',
  'PCA-FR-142': 'REAL_SOURCE_GAP',
  'PCA-FR-144': 'REAL_SOURCE_GAP',
  'PCA-NFR-014': 'REAL_SOURCE_GAP',
  'PCA-NFR-021': 'REAL_SOURCE_GAP',
  'PCA-NFR-025': 'REAL_SOURCE_GAP',
  'PCA-NFR-034': 'OWNER_DECISION_REQUIRED_FOR_SOURCE',
  'PCA-NFR-040': 'REAL_SOURCE_GAP',
  'PCA-NFR-042': 'REAL_SOURCE_GAP',
  'PCA-NFR-043': 'REAL_SOURCE_GAP',
  'PCA-NFR-044': 'REAL_SOURCE_GAP',
  'PCA-NFR-045': 'REAL_SOURCE_GAP',
  'PCA-NFR-051': 'REAL_SOURCE_GAP',
  'PCA-NFR-054': 'REAL_SOURCE_GAP',
  'PCA-NFR-060': 'REAL_SOURCE_GAP',
  'PCA-SEC-025': 'REAL_SOURCE_GAP',
  'PCA-SEC-026': 'REAL_SOURCE_GAP',
  'PCA-PRIV-001': 'REAL_SOURCE_GAP',
  'PCA-ADD-ENR-011': 'REAL_SOURCE_GAP',
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
  'PCA-ADD-PA-020': 'REAL_SOURCE_GAP',
  'PCA-ADD-PA-036': 'REAL_SOURCE_GAP',
  'PCA-ADD-BILL-026': 'REAL_SOURCE_GAP',
  'PCA-ADD-PA-041': 'REAL_SOURCE_GAP',
  'PCA-ADD-PA-043': 'REAL_SOURCE_GAP',
  'PCA-ADD-BILL-039': 'REAL_SOURCE_GAP',
  'PCA-ADD-PA-047': 'REAL_SOURCE_GAP',
  'PCA-ADD-PA-048': 'SOURCE_COMPLETE',
  'PCA-ADD-IDENT-021': 'REAL_SOURCE_GAP',
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

const matrix = JSON.parse(await readFile(matrixPath, 'utf8'));
const requirements = matrix.requirements;
for (const requirement of requirements) {
  const update = SOURCE_UPDATES[requirement.requirementId];
  if (!update) continue;
  requirement.status = update.status;
  requirement.sourceEvidence = update.sourceEvidence;
  requirement.testEvidence = update.testEvidence;
  if (update.externalGate) requirement.externalGate = update.externalGate;
  requirement.notes = update.notes;
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

const counts = Object.fromEntries(['SOURCE_COMPLETE', 'PARTIAL', 'NOT_STARTED', 'NOT_APPLICABLE'].map((status) => [status, requirements.filter((r) => r.status === status).length]));
const total = requirements.length;
if (total !== 375 || counts.SOURCE_COMPLETE + counts.PARTIAL + counts.NOT_STARTED + counts.NOT_APPLICABLE !== total) {
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
progress = progress.replace(/- Backend build and full unit\/security suite:[^\n]*/, currentHeadValidationEvidence);
progress = progress.replace(/- Parent Web typecheck, lint, test, and build:[^\n]*/, '- Parent Web typecheck: PASS; lint: PASS from the prior focused validation; test/build: RUNNER_ENVIRONMENT_BLOCKED (spawn EPERM).');
const previousDbStatus = progress.match(/CURRENT_HEAD_0020_DB_VALIDATION = (PASS|NOT_EXECUTED|BLOCKED)/)?.[1] ?? 'NOT_EXECUTED';
const dbStatus = process.env.PCA_R3_DB_VALIDATION ?? previousDbStatus;
const dbPass = dbStatus === 'PASS';
const dbSection = [
  '### Wave 11 database validation',
  '',
  '- PRE_WAVE11_DB_BASELINE = PASS',
  `- CURRENT_HEAD_0020_DB_VALIDATION = ${dbStatus}`,
  `- MIGRATION_0020_APPLIED = ${dbPass ? 'YES' : 'NOT_EXECUTED'}`,
  `- MIGRATION_0020_SCHEMA_VERIFIED = ${dbPass ? 'YES' : 'NOT_EXECUTED'}`,
  `- MYSQL_STANDARD = ${process.env.PCA_R3_MYSQL_STANDARD ?? (dbPass ? 'PASS' : 'NOT_EXECUTED')}`,
  `- MYSQL_PRIVILEGE = ${process.env.PCA_R3_MYSQL_PRIVILEGE ?? (dbPass ? 'PASS' : 'NOT_EXECUTED')}`,
  `- DB_CRITICAL_SKIPPED = ${process.env.PCA_R3_DB_CRITICAL_SKIPPED ?? (dbPass ? '0' : 'NOT_EXECUTED')}`,
  '- Scope: disposable local MySQL 8.4 Compose only; no production or Azure database was used.',
].join('\n');
const dbSectionPattern = /\n### Wave 11 database validation[\s\S]*?(?=\n### |\n## |$)/;
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
  '- Scope: bounded Safe Zone privacy and recipient-authorization mutants; temporary compiled modules are restored/deleted after each case.',
].join('\n');
const mutationSectionPattern = /\n### Current-head mutation validation[\s\S]*?(?=\n### |\n## |$)/;
progress = mutationSectionPattern.test(progress)
  ? progress.replace(mutationSectionPattern, `\n${mutationSection}`)
  : `${progress.trimEnd()}\n\n${mutationSection}\n`;
await writeFile(paths.progress, progress, 'utf8');

const triageRequired = sourceBacklogRows.filter((row) => row.SOURCE_SOLVABLE_CLASS === 'SOURCE_TRIAGE_REQUIRED').length;
console.log(JSON.stringify({ total, counts, partialPlusNotStarted, sourceBacklogRows: sourceBacklogRows.length, sourceTriageRequired: triageRequired, externalRegisterRows: externalRows.length }));
