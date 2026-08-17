import fs from "node:fs";

const root = process.cwd();

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function csvField(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function serializeCsv(rows) {
  return `${rows.map((row) => row.map(csvField).join(",")).join("\r\n")}\r\n`;
}

function keyName(headers, ...candidates) {
  const normalized = (value) => value.replace(/[^a-z0-9]/gi, "").toLowerCase();
  for (const candidate of candidates) {
    const wanted = normalized(candidate);
    const match = headers.find((header) => normalized(header) === wanted);
    if (match) return match;
  }
  throw new Error(`Missing CSV column: ${candidates.join(" / ")}`);
}

function optionalKey(headers, ...candidates) {
  const normalized = (value) => value.replace(/[^a-z0-9]/gi, "").toLowerCase();
  for (const candidate of candidates) {
    const wanted = normalized(candidate);
    const match = headers.find((header) => normalized(header) === wanted);
    if (match) return match;
  }
  return undefined;
}

function readLedger(relativePath) {
  const absolutePath = `${root}/${relativePath}`;
  const rows = parseCsv(fs.readFileSync(absolutePath, "utf8").replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error(`Ledger has no data rows: ${relativePath}`);
  const headers = rows[0];
  const index = Object.fromEntries(headers.map((header, i) => [header, i]));
  const idKey = keyName(headers, "REQUIREMENT_ID", "Requirement ID", "ID");
  return { absolutePath, rows: rows.slice(1).map((values) => Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""]))), headers, index, idKey };
}

function writeLedger(ledger) {
  const values = [ledger.headers, ...ledger.rows.map((row) => ledger.headers.map((header) => row[header] ?? ""))];
  fs.writeFileSync(ledger.absolutePath, serializeCsv(values), "utf8");
}

const currentIds = new Set(["PCA-FR-043B", "PCA-FR-043C", "PCA-FR-015A", "PCA-AND-003A"]);
const updates = {
  "PCA-FR-043B": {
    status: "SOURCE_COMPLETE",
    sourceClass: "EXTERNAL_GATE_ONLY",
    externalGate: "ANDROID_REAL_DEVICE_UAT; DEVICE_OWNER_REAL_DEVICE_AUTHORIZATION",
    sources: "android/app/src/main/java/org/pca/app/runtime/schedule/SchedulePolicy.kt; android/app/src/main/java/org/pca/app/runtime/schedule/ScheduleRuntime.kt; android/app/src/main/java/org/pca/app/runtime/schedule/ProductionScheduleRuntimePort.kt; android/app/src/main/java/org/pca/app/runtime/schedule/ScheduleEnforcementConsumer.kt; android/app/src/main/java/org/pca/app/runtime/schedule/AndroidDevicePolicyPackageSuspensionExecutor.kt; android/app/src/main/java/org/pca/app/platform/ForegroundAppPackageSource.kt; android/app/src/main/java/org/pca/app/runtime/PcaRuntime.kt",
    tests: "android/app/src/test/java/org/pca/app/runtime/schedule/NightProtectionScheduleTest.kt; android/app/src/test/java/org/pca/app/runtime/schedule/ScheduleEnforcementConsumerTest.kt",
    reachability: "SOURCE_COMPLETE_RUNTIME_REACHABLE",
    gap: "The foreground handoff and live device-owner package-suspension consumer are wired; device-owner provisioning and physical restart/offline enforcement evidence remain open.",
    validation: "Focused schedule and consumer tests pass; real device-owner provisioning, restart/offline behavior, and user-visible status confirmation remain open.",
    dependencies: "Device-owner provisioning and physical-device enforcement validation",
    nextAction: "Run device-owner provisioning and physical restart/offline enforcement validation.",
    notes: "R3 source-status normalization: all locally implementable schedule and enforcement contracts are composed and reachable. Device-owner authorization plus physical restart/offline proof remain external gates."
  },
  "PCA-FR-043C": {
    status: "SOURCE_COMPLETE",
    sourceClass: "EXTERNAL_GATE_ONLY",
    externalGate: "ANDROID_REAL_DEVICE_UAT; REAL_DEVICE_TELEPHONY_UAT; IOS_MAC_XCODE; IOS_FAMILY_CONTROLS_ENTITLEMENT; IOS_PHYSICAL_DEVICE",
    sources: "android/app/src/main/java/org/pca/app/runtime/schedule/AndroidCommunicationSurfaceResolver.kt; android/app/src/main/java/org/pca/app/runtime/communication/AndroidTelephonyCallStateObserver.kt; android/app/src/main/java/org/pca/app/runtime/communication/CommunicationCallLifecycleAdapter.kt; android/app/src/main/java/org/pca/app/runtime/communication/CommunicationExceptionCoordinator.kt; android/app/src/main/java/org/pca/app/runtime/schedule/ScheduleEnforcementConsumer.kt; android/app/src/main/java/org/pca/app/runtime/PcaRuntime.kt",
    tests: "android/app/src/test/java/org/pca/app/runtime/communication/CommunicationExceptionCoordinatorTest.kt; android/app/src/test/java/org/pca/app/runtime/communication/CommunicationCallLifecycleAdapterTest.kt; android/app/src/test/java/org/pca/app/runtime/schedule/ScheduleEnforcementConsumerTest.kt",
    reachability: "SOURCE_COMPLETE_RUNTIME_REACHABLE",
    gap: "Public capability resolution, call lifecycle composition, and safe package-level preservation are wired; Android cannot narrow package suspension to incoming-call UI, and physical native-call behavior remains open.",
    validation: "Focused lifecycle and consumer tests pass; incoming-call answer/end behavior across night and break boundaries remains a real-device gate.",
    dependencies: "Physical-device telephony validation and platform call-surface limits",
    nextAction: "Validate incoming-call answer/end across night and Break Shield windows without broadening the safety surface.",
    notes: "R3 source-status normalization: public capability resolution, call lifecycle, and safe package-level preservation are composed. Android call-surface precision and all physical/iOS confirmation remain external platform gates; no private API or broad allowlist is claimed."
  },
  "PCA-FR-015A": {
    status: "SOURCE_COMPLETE",
    sourceClass: "EXTERNAL_GATE_ONLY",
    externalGate: "ANDROID_REAL_DEVICE_UAT; REAL_DEVICE_TELEPHONY_SMS_UAT; IOS_MAC_XCODE; IOS_FAMILY_CONTROLS_ENTITLEMENT; IOS_PHYSICAL_DEVICE",
    sources: "android/app/src/main/java/org/pca/app/feature/screentime/engine/ScreenTimeEngine.kt; android/app/src/main/java/org/pca/app/runtime/communication/CommunicationExceptionCoordinator.kt; android/app/src/main/java/org/pca/app/runtime/communication/AndroidTelephonyCallStateObserver.kt; android/app/src/main/java/org/pca/app/runtime/communication/CommunicationCallStateObserver.kt; android/app/src/main/java/org/pca/app/runtime/schedule/ScheduleEnforcementConsumer.kt; android/app/src/main/java/org/pca/app/platform/ForegroundAppPackageSource.kt; android/app/src/main/java/org/pca/app/runtime/ui/CallStatePermissionPromptPolicy.kt; android/app/src/main/java/org/pca/app/runtime/ui/ChildHomeScreen.kt; android/app/src/main/java/org/pca/app/MainActivity.kt; android/app/src/main/java/org/pca/app/runtime/PcaRuntime.kt",
    tests: "android/app/src/test/java/org/pca/app/runtime/communication/CommunicationBreakShieldIntegrationTest.kt; android/app/src/test/java/org/pca/app/runtime/communication/CommunicationExceptionCoordinatorTest.kt; android/app/src/test/java/org/pca/app/feature/screentime/engine/ScreenTimeEngineTest.kt; android/app/src/test/java/org/pca/app/runtime/schedule/ScheduleEnforcementConsumerTest.kt; android/app/src/test/java/org/pca/app/runtime/ui/CallStatePermissionPromptPolicyTest.kt; android/app/src/test/java/org/pca/app/runtime/communication/CommunicationCallStateObserverAvailabilityTest.kt",
    reachability: "SOURCE_COMPLETE_RUNTIME_REACHABLE",
    gap: "Break Shield call pause/restore, foreground schedule handoff, typed SMS transport preservation, and one-shot READ_PHONE_STATE permission UX are wired; physical call/SMS delivery remains open.",
    validation: "Focused Break Shield, lifecycle, engine, consumer, permission-policy, and unavailable-observer tests pass; real call/SMS delivery remains open.",
    dependencies: "Physical-device telephony/SMS validation",
    nextAction: "Run physical call/SMS validation near break completion and night boundaries, including restart with a persisted break.",
    notes: "R3 source-status normalization: Break Shield call pause/restore, schedule handoff, typed SMS transport preservation, Settings-return permission refresh, and one-shot READ_PHONE_STATE UX are composed. Physical call/SMS delivery remains external."
  },
  "PCA-AND-003A": {
    status: "SOURCE_COMPLETE",
    sourceClass: "EXTERNAL_GATE_ONLY",
    externalGate: "ANDROID_REAL_DEVICE_UAT; DEVICE_OWNER_REAL_DEVICE_AUTHORIZATION; REAL_DEVICE_TELEPHONY_SMS_UAT",
    sources: "android/app/src/main/java/org/pca/app/runtime/schedule/SchedulePolicy.kt; android/app/src/main/java/org/pca/app/runtime/schedule/EmergencyAccessFloor.kt; android/app/src/main/java/org/pca/app/runtime/schedule/AndroidCommunicationSurfaceResolver.kt; android/app/src/main/java/org/pca/app/runtime/communication/AndroidTelephonyCallStateObserver.kt; android/app/src/main/java/org/pca/app/runtime/schedule/ScheduleEnforcementConsumer.kt; android/app/src/main/java/org/pca/app/runtime/schedule/AndroidDevicePolicyPackageSuspensionExecutor.kt",
    tests: "android/app/src/test/java/org/pca/app/runtime/schedule/EmergencyAccessFloorTest.kt; android/app/src/test/java/org/pca/app/runtime/communication/CommunicationCallLifecycleAdapterTest.kt; android/app/src/test/java/org/pca/app/runtime/schedule/ScheduleEnforcementConsumerTest.kt",
    reachability: "SOURCE_COMPLETE_RUNTIME_REACHABLE",
    gap: "Typed emergency/call/SMS surfaces, public resolver, observer, and device-owner consumer are wired; physical emergency/call/SMS behavior remains open and Messages UI cannot be narrowed separately by public package APIs.",
    validation: "Emergency floor, lifecycle, and consumer tests pass; physical-device emergency/call/SMS behavior remains open.",
    dependencies: "Device-owner provisioning and physical-device communication validation",
    nextAction: "Run real-device emergency, incoming-call, and SMS-delivery validation without OEM hardcoding or private APIs.",
    notes: "R3 source-status normalization: emergency floor, typed surfaces, foreground handoff, and device-owner consumer preserve emergency/call/SMS transport without a generic allowlist. Physical validation and device-owner authorization remain external."
  }
};

for (const relativePath of [
  ".agent-runtime/manifests/pca-r3-final/R3_REQUIREMENT_AUDIT.csv",
  ".agent-runtime/manifests/pca-r3-final/R3_SOURCE_BACKLOG.csv",
  ".agent-runtime/manifests/pca-r3-final/R3_VALIDATION_BACKLOG.csv"
]) {
  const ledger = readLedger(relativePath);
  const before = ledger.rows.length;
  ledger.rows = ledger.rows.filter((row) => /^PCA-/.test(row[ledger.idKey] ?? ""));
  for (const row of ledger.rows) {
    const update = updates[row[ledger.idKey]];
    if (!update) continue;
    const sourceKey = optionalKey(ledger.headers, "SOURCE_EVIDENCE", "Source Evidence");
    const testKey = optionalKey(ledger.headers, "TEST_EVIDENCE", "Test Evidence");
    if (sourceKey) row[sourceKey] = update.sources;
    if (testKey) row[testKey] = update.tests;
    const statusKey = optionalKey(ledger.headers, "CURRENT_STATUS", "STATUS", "Status");
    const sourceClassKey = optionalKey(ledger.headers, "SOURCE_SOLVABLE_CLASS", "SOURCE_SOLVABLE", "Source Solvable");
    const externalGateKey = optionalKey(ledger.headers, "EXTERNAL_GATE", "External Gate");
    if (statusKey) row[statusKey] = update.status;
    if (sourceClassKey) row[sourceClassKey] = update.sourceClass;
    if (externalGateKey && relativePath.includes("R3_SOURCE_BACKLOG")) row[externalGateKey] = update.externalGate;
    const gapKey = optionalKey(ledger.headers, "SOURCE_GAP", "CURRENT_GAP", "Source Gap", "Current Gap");
    if (gapKey) row[gapKey] = update.gap;
    if (ledger.headers.some((header) => header.replace(/[^a-z0-9]/gi, "").toLowerCase() === "nextaction")) {
      row[optionalKey(ledger.headers, "NEXT_ACTION", "Next Action")] = update.nextAction;
    }
    if (ledger.headers.some((header) => header.replace(/[^a-z0-9]/gi, "").toLowerCase() === "validationgap")) {
      row[optionalKey(ledger.headers, "VALIDATION_GAP", "Validation Gap")] = update.validation;
    }
    if (ledger.headers.some((header) => header.replace(/[^a-z0-9]/gi, "").toLowerCase() === "runtimereachability")) {
      row[optionalKey(ledger.headers, "RUNTIME_REACHABILITY", "Runtime Reachability")] = update.reachability;
    }
    if (ledger.headers.some((header) => header.replace(/[^a-z0-9]/gi, "").toLowerCase() === "dependencies")) {
      row[optionalKey(ledger.headers, "DEPENDENCIES", "Dependencies")] = update.dependencies;
    }
    if (ledger.headers.some((header) => header.replace(/[^a-z0-9]/gi, "").toLowerCase() === "requiredvalidation")) {
      row[optionalKey(ledger.headers, "REQUIRED_VALIDATION", "Required Validation")] = update.validation;
    }
    const validationStateKey = optionalKey(ledger.headers, "VALIDATION_STATE", "Validation State");
    if (validationStateKey && relativePath.includes("R3_VALIDATION_BACKLOG")) row[validationStateKey] = "SOURCE_COMPLETE_VALIDATION_PENDING";
  }
  writeLedger(ledger);
  console.log(`${relativePath}: ${before} -> ${ledger.rows.length}`);
}

const matrixPath = `${root}/docs/implementation/PCA_COMPLETION_V2_MATRIX.json`;
const matrix = JSON.parse(fs.readFileSync(matrixPath, "utf8"));
for (const requirement of matrix.requirements) {
  const update = updates[requirement.requirementId];
  if (!update) continue;
  requirement.sourceEvidence = update.sources.split("; ");
  requirement.testEvidence = update.tests.split("; ");
  requirement.status = update.status;
  requirement.externalGate = update.externalGate.split("; ");
  requirement.notes = update.notes;
  if (requirement.requirementId === "PCA-FR-043C") requirement.iosSourceClassification = "PLATFORM_UNSUPPORTED_WITH_HONEST_DEGRADATION";
}
fs.writeFileSync(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`, "utf8");
console.log(`${matrixPath}: updated ${currentIds.size} requirement records`);

for (const relativePath of [
  ".agent-runtime/manifests/pca-r3-final/R3_PROGRESS_LEDGER.md",
  "docs/implementation/PCA_IMPLEMENTATION_TRACEABILITY.md"
]) {
  const absolutePath = `${root}/${relativePath}`;
  const content = fs.readFileSync(absolutePath, "utf8");
  const repaired = content.replaceAll("\\n", "\n");
  fs.writeFileSync(absolutePath, repaired, "utf8");
  console.log(`${relativePath}: literal-newlines ${content.split("\\n").length - 1} -> ${repaired.split("\\n").length - 1}`);
}

console.log(`updated requirement ids: ${[...currentIds].join(", ")}`);
