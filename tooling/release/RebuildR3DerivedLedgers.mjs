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
      'parent-web/src/pages/children/LocationPage.tsx',
      'parent-web/src/api/real/realSafeZoneClient.ts',
      'backend/migrations/0020_parent_preferences_safe_zones.sql',
    ],
    testEvidence: ['android/app/src/test/java/org/pca/app/runtime/location/geofence/GeofenceEngineTest.kt', 'backend/test/parentaccount/preferencesSafeZonesRoute.test.mjs'],
    sourceSolvableClass: 'SOURCE_COMPLETE_EXTERNAL_GATE',
    currentGap: 'Parent authoring, validation, family/child authorization, revisioning, and pending-offline policy metadata are now real. Applying the policy to the child device and marking delivery READY still depends on the runtime sync/crypto and device validation gates.',
    validationGap: 'Focused route behavior passes in-process; Node worker mode is blocked by environment spawn EPERM, and disposable MySQL plus Android device delivery validation remain unexecuted.',
    nextAction: 'Keep the external runtime delivery gate open and validate the migration, sync delivery, and device application when those environments are available.',
    notes: 'Safe zones store opaque child assignment and policy metadata only. No central readable movement history is introduced.',
  },
  'PCA-FR-091': {
    status: 'PARTIAL',
    sourceEvidence: ['parent-web/src/pages/children/LocationPage.tsx', 'parent-web/src/api/interfaces.ts', 'parent-web/src/api/real/realSafeZoneClient.ts', 'backend/src/http/routes/parentAccountRoutes.ts'],
    testEvidence: ['backend/test/parentaccount/preferencesSafeZonesRoute.test.mjs'],
    sourceSolvableClass: 'SOURCE_COMPLETE_EXTERNAL_GATE',
    currentGap: 'Parent Web now exposes localized safe-zone create/list/enable/disable/delete controls with validation and pending-offline status. Child-device policy application remains externally gated by runtime sync and device validation.',
    validationGap: 'Parent Web typecheck passes and focused route behavior passes in-process; browser axe/RTL journey and live MySQL validation remain pending.',
    nextAction: 'Run the routed browser accessibility journey and disposable MySQL migration/authz tests when available.',
    notes: 'The UI deliberately renders policy metadata and delivery state, not a movement timeline.',
  },
  'PCA-FR-094': {
    status: 'PARTIAL',
    sourceEvidence: ['backend/src/parentaccount/ParentPreferenceRepository.ts', 'backend/src/parentaccount/MySqlParentPreferenceRepository.ts', 'backend/src/http/routes/parentAccountRoutes.ts', 'backend/migrations/0020_parent_preferences_safe_zones.sql', 'parent-web/src/pages/Notifications.tsx', 'parent-web/src/api/real/realParentPreferencesClient.ts'],
    testEvidence: ['backend/test/parentaccount/preferencesSafeZonesRoute.test.mjs'],
    sourceSolvableClass: 'SOURCE_COMPLETE_EXTERNAL_GATE',
    currentGap: 'Approved email-alert and push-request categories now persist per authenticated parent account and the UI has retry/error behavior. Provider delivery, destination enrollment, and live MySQL validation remain external or unexecuted.',
    validationGap: 'Focused account-isolation/CSRF behavior passes in-process and Parent Web typecheck passes; Node worker mode is blocked by spawn EPERM and MySQL/provider delivery evidence is pending.',
    nextAction: 'Validate migration and downstream notification delivery without introducing invasive or child-content categories.',
    notes: 'The preference vocabulary is intentionally closed to the two approved categories; no invasive child-activity notification category is exposed.',
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
};

const SOURCE_CLASSIFICATIONS = {
  'PCA-DATA-021': 'REAL_SOURCE_GAP',
  'PCA-FR-000A': 'REAL_SOURCE_GAP',
  'PCA-FR-008': 'REAL_SOURCE_GAP',
  'PCA-FR-021': 'OWNER_DECISION_REQUIRED_FOR_SOURCE',
  'PCA-FR-023': 'OWNER_DECISION_REQUIRED_FOR_SOURCE',
  'PCA-FR-053': 'SOURCE_COMPLETE_EXTERNAL_GATE',
  'PCA-FR-080': 'OWNER_DECISION_REQUIRED_FOR_SOURCE',
  'PCA-FR-113': 'SOURCE_COMPLETE_EXTERNAL_GATE',
  'PCA-FR-114': 'REAL_SOURCE_GAP',
  'PCA-FR-124': 'REAL_SOURCE_GAP',
  'PCA-FR-127': 'SOURCE_COMPLETE_EXTERNAL_GATE',
  'PCA-FR-131': 'OWNER_DECISION_REQUIRED_FOR_SOURCE',
  'PCA-FR-135': 'SOURCE_COMPLETE_EXTERNAL_GATE',
  'PCA-FR-137': 'SOURCE_COMPLETE_EXTERNAL_GATE',
  'PCA-FR-140': 'SOURCE_COMPLETE_EXTERNAL_GATE',
  'PCA-FR-142': 'SOURCE_COMPLETE_EXTERNAL_GATE',
  'PCA-FR-144': 'OWNER_DECISION_REQUIRED_FOR_SOURCE',
  'PCA-NFR-014': 'SOURCE_COMPLETE_EXTERNAL_GATE',
  'PCA-NFR-021': 'REAL_SOURCE_GAP',
  'PCA-NFR-025': 'REAL_SOURCE_GAP',
  'PCA-NFR-034': 'OWNER_DECISION_REQUIRED_FOR_SOURCE',
  'PCA-NFR-040': 'REAL_SOURCE_GAP',
  'PCA-NFR-042': 'REAL_SOURCE_GAP',
  'PCA-NFR-043': 'REAL_SOURCE_GAP',
  'PCA-NFR-044': 'REAL_SOURCE_GAP',
  'PCA-NFR-045': 'REAL_SOURCE_GAP',
  'PCA-NFR-051': 'SOURCE_COMPLETE_EXTERNAL_GATE',
  'PCA-NFR-054': 'OWNER_DECISION_REQUIRED_FOR_SOURCE',
  'PCA-NFR-060': 'SOURCE_COMPLETE_EXTERNAL_GATE',
  'PCA-SEC-025': 'REAL_SOURCE_GAP',
  'PCA-SEC-026': 'REAL_SOURCE_GAP',
  'PCA-ADD-ENR-011': 'REAL_SOURCE_GAP',
  'PCA-ADD-ENR-012': 'REAL_SOURCE_GAP',
  'PCA-ADD-ENR-014': 'REAL_SOURCE_GAP',
  'PCA-ADD-ENR-016': 'REAL_SOURCE_GAP',
  'PCA-ADD-ENR-017': 'REAL_SOURCE_GAP',
  'PCA-ADD-ENR-020': 'REAL_SOURCE_GAP',
  'PCA-ADD-ENR-021': 'REAL_SOURCE_GAP',
  'PCA-ADD-ENR-025': 'REAL_SOURCE_GAP',
  'PCA-ADD-PA-006': 'OWNER_DECISION_REQUIRED_FOR_SOURCE',
  'PCA-ADD-PA-020': 'REAL_SOURCE_GAP',
  'PCA-ADD-PA-036': 'REAL_SOURCE_GAP',
  'PCA-ADD-BILL-026': 'REAL_SOURCE_GAP',
  'PCA-ADD-PA-041': 'REAL_SOURCE_GAP',
  'PCA-ADD-PA-043': 'REAL_SOURCE_GAP',
  'PCA-ADD-BILL-039': 'SOURCE_COMPLETE_EXTERNAL_GATE',
  'PCA-ADD-PA-047': 'SOURCE_COMPLETE_EXTERNAL_GATE',
  'PCA-ADD-PA-048': 'OWNER_DECISION_REQUIRED_FOR_SOURCE',
  'PCA-ADD-IDENT-021': 'SOURCE_COMPLETE_EXTERNAL_GATE',
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
  const normalizedBacklogClass = {
    EXTERNAL_GATE: 'SOURCE_COMPLETE_EXTERNAL_GATE',
    OWNER_OR_ENVIRONMENT_GATE: 'SOURCE_COMPLETE_OWNER_DECISION_GATE',
    SOURCE_TRIAGE_REQUIRED: 'REAL_SOURCE_GAP',
  }[sourceClass] ?? sourceClass;
  setIfPresent(row, 'SOURCE_SOLVABLE_CLASS', requirement.status === 'PARTIAL' || requirement.status === 'NOT_STARTED' ? normalizedBacklogClass : sourceClass);
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
  requirement.notes = update.notes;
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
  ?? progress.match(/- Backend build and full unit\/security suite:[^\n]*/)?.[0]
  ?? '- Backend build and full unit/security suite: NOT_EXECUTED.';
progress = progress.replace(/- Backend build and full unit\/security suite:[^\n]*/, currentHeadValidationEvidence);
const previousDbStatus = progress.match(/CURRENT_HEAD_0019_DB_VALIDATION = (PASS|NOT_EXECUTED|BLOCKED)/)?.[1] ?? 'NOT_EXECUTED';
const dbStatus = process.env.PCA_R3_DB_VALIDATION ?? previousDbStatus;
const dbPass = dbStatus === 'PASS';
const dbSection = [
  '### Wave 11 database validation',
  '',
  '- PRE_WAVE11_DB_BASELINE = PASS',
  `- CURRENT_HEAD_0019_DB_VALIDATION = ${dbStatus}`,
  `- MIGRATION_0019_APPLIED = ${dbPass ? 'YES' : 'NOT_EXECUTED'}`,
  `- MIGRATION_0019_SCHEMA_VERIFIED = ${dbPass ? 'YES' : 'NOT_EXECUTED'}`,
  `- MYSQL_STANDARD = ${process.env.PCA_R3_MYSQL_STANDARD ?? (dbPass ? 'PASS' : 'NOT_EXECUTED')}`,
  `- MYSQL_PRIVILEGE = ${process.env.PCA_R3_MYSQL_PRIVILEGE ?? (dbPass ? 'PASS' : 'NOT_EXECUTED')}`,
  `- DB_CRITICAL_SKIPPED = ${process.env.PCA_R3_DB_CRITICAL_SKIPPED ?? (dbPass ? '0' : 'NOT_EXECUTED')}`,
  '- Scope: disposable local MySQL 8.4 Compose only; no production or Azure database was used.',
].join('\n');
const dbSectionPattern = /\n### Wave 11 database validation[\s\S]*?(?=\n### |\n## |$)/;
progress = dbSectionPattern.test(progress)
  ? progress.replace(dbSectionPattern, `\n${dbSection}`)
  : `${progress.trimEnd()}\n\n${dbSection}\n`;
await writeFile(paths.progress, progress, 'utf8');

const triageRequired = sourceBacklogRows.filter((row) => row.SOURCE_SOLVABLE_CLASS === 'SOURCE_TRIAGE_REQUIRED').length;
console.log(JSON.stringify({ total, counts, partialPlusNotStarted, sourceBacklogRows: sourceBacklogRows.length, sourceTriageRequired: triageRequired, externalRegisterRows: externalRows.length }));
