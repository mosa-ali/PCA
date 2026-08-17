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
    sources: "android/app/src/main/java/org/pca/app/runtime/schedule/SchedulePolicy.kt; android/app/src/main/java/org/pca/app/runtime/schedule/ScheduleRuntime.kt; android/app/src/main/java/org/pca/app/runtime/schedule/ProductionScheduleRuntimePort.kt",
    tests: "android/app/src/test/java/org/pca/app/runtime/schedule/NightProtectionScheduleTest.kt",
    reachability: "PARTIAL_CONSUMER_GAP",
    gap: "The additive 21:30-07:00 baseline and accepted-policy/status path are wired; no real per-app or device restriction consumer is yet connected.",
    validation: "Focused schedule tests and full Android unit/lint/build gates pass; a supported enforcement consumer and real-device restart/offline proof remain open.",
    dependencies: "Supported Android enforcement authority and physical-device validation"
  },
  "PCA-FR-043C": {
    sources: "android/app/src/main/java/org/pca/app/runtime/communication/AndroidCommunicationSurfaceResolver.kt; android/app/src/main/java/org/pca/app/runtime/communication/AndroidTelephonyCallStateObserver.kt; android/app/src/main/java/org/pca/app/runtime/communication/CommunicationCallLifecycleAdapter.kt; android/app/src/main/java/org/pca/app/runtime/communication/CommunicationExceptionCoordinator.kt; android/app/src/main/java/org/pca/app/runtime/PcaRuntime.kt",
    tests: "android/app/src/test/java/org/pca/app/runtime/communication/CommunicationExceptionCoordinatorTest.kt; android/app/src/test/java/org/pca/app/runtime/communication/CommunicationCallLifecycleAdapterTest.kt",
    reachability: "SOURCE_COMPOSED_EXTERNAL_BEHAVIOR_REMAINS",
    gap: "Public capability resolution and call lifecycle composition are wired; narrow call-surface enforcement and physical native-call behavior remain open.",
    validation: "Focused lifecycle tests and full Android unit/lint/build gates pass; supported native incoming-call behavior remains a real-device gate.",
    dependencies: "Supported Android call-surface enforcement and physical-device telephony validation"
  },
  "PCA-FR-015A": {
    sources: "android/app/src/main/java/org/pca/app/feature/screentime/engine/ScreenTimeEngine.kt; android/app/src/main/java/org/pca/app/runtime/communication/CommunicationExceptionCoordinator.kt; android/app/src/main/java/org/pca/app/runtime/communication/AndroidTelephonyCallStateObserver.kt; android/app/src/main/java/org/pca/app/runtime/PcaRuntime.kt",
    tests: "android/app/src/test/java/org/pca/app/runtime/communication/CommunicationBreakShieldIntegrationTest.kt; android/app/src/test/java/org/pca/app/runtime/communication/CommunicationExceptionCoordinatorTest.kt; android/app/src/test/java/org/pca/app/feature/screentime/engine/ScreenTimeEngineTest.kt",
    reachability: "SOURCE_COMPOSED_EXTERNAL_BEHAVIOR_REMAINS",
    gap: "RINGING, answered-call pause, exact state restoration, and SMS non-allowlist modeling are source-covered; permission/unavailable behavior and real call/SMS delivery remain open.",
    validation: "Focused Break Shield, lifecycle, and engine tests and full Android gates pass; permission-denied behavior and real call/SMS delivery remain open.",
    dependencies: "READ_PHONE_STATE permission UX and physical-device telephony/SMS validation"
  },
  "PCA-AND-003A": {
    sources: "android/app/src/main/java/org/pca/app/runtime/schedule/SchedulePolicy.kt; android/app/src/main/java/org/pca/app/runtime/communication/EmergencyAccessFloor.kt; android/app/src/main/java/org/pca/app/runtime/communication/AndroidCommunicationSurfaceResolver.kt; android/app/src/main/java/org/pca/app/runtime/communication/AndroidTelephonyCallStateObserver.kt",
    tests: "android/app/src/test/java/org/pca/app/runtime/communication/EmergencyAccessFloorTest.kt; android/app/src/test/java/org/pca/app/runtime/communication/CommunicationCallLifecycleAdapterTest.kt",
    reachability: "SOURCE_COMPOSED_EXTERNAL_BEHAVIOR_REMAINS",
    gap: "Typed emergency/call/SMS surfaces, public resolver, and observer are wired; the enforcement consumer must consume call safety without creating a generic SMS UI exemption.",
    validation: "Emergency floor and lifecycle tests and full Android gates pass; supported enforcement and physical-device behavior remain open.",
    dependencies: "Supported Android enforcement authority and physical-device validation"
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
    const gapKey = optionalKey(ledger.headers, "SOURCE_GAP", "CURRENT_GAP", "Source Gap", "Current Gap");
    if (gapKey) row[gapKey] = update.gap;
    if (ledger.headers.some((header) => header.replace(/[^a-z0-9]/gi, "").toLowerCase() === "nextaction")) {
      row[optionalKey(ledger.headers, "NEXT_ACTION", "Next Action")] = "Implement a supported enforcement consumer and test its blocked result/user-visible state; keep real-device confirmation separate.";
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
  }
  writeLedger(ledger);
  console.log(`${relativePath}: ${before} -> ${ledger.rows.length}`);
}

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
