"use strict";

const requiredConnectionStates = new Set(["OFFLINE", "SYNC_PENDING", "SYNCING", "LIVE", "STALE"]);
const requiredPriorityTiers = new Set([
  "TRUST_SECURITY", "POLICY", "DECISION", "APPLICATION_RECEIPT", "CRITICAL_STATE", "ACTIVITY_SUMMARY",
]);

function validateCatalogue(catalogue) {
  const errors = [];
  if (catalogue.representation !== "neutral") errors.push("catalogue must remain representation neutral");
  if (catalogue.contractVersion !== 1) errors.push("contract version must be 1");

  const states = new Set(catalogue.connectionStates || []);
  for (const state of requiredConnectionStates) if (!states.has(state)) errors.push(`missing connection state: ${state}`);
  for (const state of states) if (!requiredConnectionStates.has(state)) errors.push(`unrecognised connection state: ${state}`);

  const liveRequires = new Set((catalogue.connectionStateRule || {}).liveRequires || []);
  if (!liveRequires.has("transportConnected") || !liveRequires.has("recentSuccessfulSync")) {
    errors.push("LIVE must require both transportConnected and recentSuccessfulSync");
  }
  if ((catalogue.connectionStateRule || {}).transportConnectedAloneImplies !== "not-live") {
    errors.push("transport connectivity alone must never imply LIVE");
  }

  const batch = catalogue.outboundBatch || {};
  if (!(batch.maxItemsPerAttempt > 0 && batch.maxItemsPerAttempt <= 1000)) {
    errors.push("maxItemsPerAttempt must be a small positive bound (no unbounded drain)");
  }
  if (!(batch.maxRetryCount > 0 && batch.maxRetryCount <= 100)) {
    errors.push("maxRetryCount must be a bounded positive ceiling");
  }
  const backoff = batch.backoff || {};
  if (!(backoff.baseMs > 0)) errors.push("backoff.baseMs must be a positive floor");
  if (!(backoff.capMs > 0 && backoff.capMs >= backoff.baseMs)) errors.push("backoff.capMs must bound baseMs from above");

  const tiers = new Set(catalogue.priorityTiers || []);
  for (const tier of requiredPriorityTiers) if (!tiers.has(tier)) errors.push(`missing priority tier: ${tier}`);
  for (const tier of tiers) if (!requiredPriorityTiers.has(tier)) errors.push(`unrecognised priority tier: ${tier}`);

  const tierMap = catalogue.priorityMessageTypeMap || {};
  for (const [messageType, tier] of Object.entries(tierMap)) {
    if (!requiredPriorityTiers.has(tier)) errors.push(`message type ${messageType} maps to unrecognised tier: ${tier}`);
  }

  const e2ee = catalogue.e2eeBoundary || {};
  if (e2ee.serverDecryption !== "forbidden") errors.push("server decryption must remain forbidden");
  const visibility = new Set(e2ee.serviceVisibility || []);
  if (!visibility.has("opaque-envelope-metadata") || !visibility.has("ciphertext")) {
    errors.push("service visibility must include opaque-envelope-metadata and ciphertext");
  }
  for (const forbidden of ["decrypted-payload", "policy-content", "location", "activity-content"]) {
    if (visibility.has(forbidden)) errors.push(`service must not be declared visible to: ${forbidden}`);
  }
  if (e2ee.cryptoSuiteStatus !== "PENDING_HUMAN_SECURITY_REVIEW") {
    errors.push("cryptoSuiteStatus must remain PENDING_HUMAN_SECURITY_REVIEW until a human security review selects one");
  }

  return errors;
}

/**
 * PCA-FINAL-ASSESSMENT 2026-09-08 (FABLE-A017): the catalogue declares an
 * httpSurface and two error-code vocabularies whose stated authority is
 * backend source, but nothing ever compared them -- a route could be added to
 * backend/src/http/routes/runtimeSyncRoutes.ts (POST /v1/runtime-sync/
 * protection-status was) or a phantom error code declared here, behind a
 * green gate. This cross-check reads the authoritative source files and
 * fails on drift in either direction.
 *
 * sources = { routes, deviceSession, outbound, sdkTypes? } -- raw file text.
 */
function validateHttpSurfaceAgainstSource(catalogue, sources) {
  const errors = [];
  const routeRegex = /app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g;
  const sourceRoutes = new Set();
  for (const match of sources.routes.matchAll(routeRegex)) sourceRoutes.add(`${match[1].toUpperCase()} ${match[2]}`);
  const declared = new Set(((catalogue.httpSurface || {}).routes || []).map((route) => `${String(route.method).toUpperCase()} ${route.path}`));
  if (sourceRoutes.size === 0) errors.push('could not parse any route registration from the runtime-sync route source (parser drift?)');
  for (const route of sourceRoutes) if (!declared.has(route)) errors.push(`route registered in source but absent from catalogue httpSurface: ${route}`);
  for (const route of declared) if (!sourceRoutes.has(route)) errors.push(`catalogue httpSurface declares a route the source does not register: ${route}`);
  for (const route of (catalogue.httpSurface || {}).routes || []) {
    if (!route.auth) errors.push(`catalogue route ${route.method} ${route.path} declares no auth posture`);
  }

  const authUnion = sources.deviceSession.match(/export type RuntimeSyncAuthErrorCode\s*=\s*([^;]+);/);
  if (!authUnion) errors.push('could not parse RuntimeSyncAuthErrorCode from DeviceSessionService source');
  else {
    const sourceCodes = new Set([...authUnion[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]));
    const declaredCodes = new Set(catalogue.deviceSessionErrorCodes || []);
    for (const code of sourceCodes) if (!declaredCodes.has(code)) errors.push(`device-session error code emitted by source but absent from catalogue: ${code}`);
    for (const code of declaredCodes) if (!sourceCodes.has(code)) errors.push(`catalogue declares a phantom device-session error code: ${code}`);
  }

  const outcomeUnion = sources.outbound.match(/export type OutboundItemOutcome\s*=\s*([\s\S]*?)\n\n/);
  if (!outcomeUnion) errors.push('could not parse OutboundItemOutcome from OutboundRelayService source');
  else {
    const sourceOutcomes = new Set([...outcomeUnion[1].matchAll(/outcome:\s*'([A-Z_]+)'/g)].map((m) => m[1]));
    sourceOutcomes.delete('QUEUED');
    const declaredOutcomes = new Set(catalogue.outboundSubmitErrorCodes || []);
    for (const code of sourceOutcomes) if (!declaredOutcomes.has(code)) errors.push(`outbound per-item outcome emitted by source but absent from catalogue: ${code}`);
    for (const code of declaredOutcomes) if (!sourceOutcomes.has(code)) errors.push(`catalogue declares a phantom outbound error code: ${code}`);
    if (sources.sdkTypes) {
      const sdkUnion = sources.sdkTypes.match(/export type OutboundItemOutcome\s*=\s*([\s\S]*?)\n\n/);
      if (!sdkUnion) errors.push('could not parse OutboundItemOutcome from parent-sdk runtime-sync types');
      else {
        const sdkOutcomes = new Set([...sdkUnion[1].matchAll(/outcome:\s*'([A-Z_]+)'/g)].map((m) => m[1]));
        sdkOutcomes.delete('QUEUED');
        for (const code of sourceOutcomes) if (!sdkOutcomes.has(code)) errors.push(`backend emits outbound outcome the parent-sdk vocabulary lacks: ${code}`);
        for (const code of sdkOutcomes) if (!sourceOutcomes.has(code)) errors.push(`parent-sdk declares an outbound outcome the backend never emits: ${code}`);
      }
    }
  }
  return errors;
}

function loadAuthoritySources() {
  const fs = require("node:fs");
  const path = require("node:path");
  const repoRoot = path.resolve(__dirname, "..", "..");
  return {
    routes: fs.readFileSync(path.join(repoRoot, "backend", "src", "http", "routes", "runtimeSyncRoutes.ts"), "utf8"),
    deviceSession: fs.readFileSync(path.join(repoRoot, "backend", "src", "runtime-sync", "DeviceSessionService.ts"), "utf8"),
    outbound: fs.readFileSync(path.join(repoRoot, "backend", "src", "runtime-sync", "OutboundRelayService.ts"), "utf8"),
    sdkTypes: fs.readFileSync(path.join(repoRoot, "parent-sdk", "runtime-sync", "src", "types.ts"), "utf8"),
  };
}

module.exports = { validateCatalogue, validateHttpSurfaceAgainstSource, loadAuthoritySources };

// PCA-FINAL-ASSESSMENT 2026-09-08 (FABLE-A017): this file used to be an
// export-only module, so the CI step `node contracts/runtime-sync/validate-catalogue.cjs`
// loaded it and exited 0 without validating anything. Running it directly now
// validates the catalogue AND cross-checks it against backend/parent-sdk source.
if (require.main === module) {
  const catalogue = require('./catalogue.json');
  const errors = [...validateCatalogue(catalogue), ...validateHttpSurfaceAgainstSource(catalogue, loadAuthoritySources())];
  if (errors.length > 0) {
    console.error(`contracts/runtime-sync/validate-catalogue.cjs: FAIL (${errors.length} error(s))`);
    for (const error of errors) console.error(` - ${error}`);
    process.exit(1);
  }
  console.log('contracts/runtime-sync/validate-catalogue.cjs: OK -- catalogue validated and reconciled against backend/parent-sdk source');
}
