"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const catalogue = require("../catalogue.json");
const { validateCatalogue, validateHttpSurfaceAgainstSource, loadAuthoritySources } = require("../validate-catalogue.cjs");

function clone(value) { return JSON.parse(JSON.stringify(value)); }

test("runtime-sync catalogue validates against the doc-40 foundation", () => {
  assert.deepEqual(validateCatalogue(catalogue), []);
});

test("missing connection state is rejected", () => {
  const invalid = clone(catalogue);
  invalid.connectionStates = invalid.connectionStates.filter((s) => s !== "STALE");
  assert.match(validateCatalogue(invalid).join("\n"), /missing connection state: STALE/);
});

test("LIVE-from-transport-alone is rejected", () => {
  const invalid = clone(catalogue);
  invalid.connectionStateRule.transportConnectedAloneImplies = "live";
  assert.match(validateCatalogue(invalid).join("\n"), /transport connectivity alone must never imply LIVE/);
});

test("unbounded batch size is rejected", () => {
  const invalid = clone(catalogue);
  invalid.outboundBatch.maxItemsPerAttempt = 100000;
  assert.match(validateCatalogue(invalid).join("\n"), /maxItemsPerAttempt must be a small positive bound/);
});

test("zero backoff floor is rejected", () => {
  const invalid = clone(catalogue);
  invalid.outboundBatch.backoff.baseMs = 0;
  assert.match(validateCatalogue(invalid).join("\n"), /backoff.baseMs must be a positive floor/);
});

test("unrecognised priority tier is rejected", () => {
  const invalid = clone(catalogue);
  invalid.priorityTiers.push("URGENT");
  assert.match(validateCatalogue(invalid).join("\n"), /unrecognised priority tier: URGENT/);
});

test("priority map referencing an unknown tier is rejected", () => {
  const invalid = clone(catalogue);
  invalid.priorityMessageTypeMap.POLICY_UPDATE = "URGENT";
  assert.match(validateCatalogue(invalid).join("\n"), /POLICY_UPDATE maps to unrecognised tier: URGENT/);
});

test("declaring server decryption permitted is rejected", () => {
  const invalid = clone(catalogue);
  invalid.e2eeBoundary.serverDecryption = "permitted";
  assert.match(validateCatalogue(invalid).join("\n"), /server decryption must remain forbidden/);
});

test("service visibility leaking decrypted payload is rejected", () => {
  const invalid = clone(catalogue);
  invalid.e2eeBoundary.serviceVisibility.push("decrypted-payload");
  assert.match(validateCatalogue(invalid).join("\n"), /service must not be declared visible to: decrypted-payload/);
});

test("marking the crypto suite reviewed without review is rejected", () => {
  const invalid = clone(catalogue);
  invalid.e2eeBoundary.cryptoSuiteStatus = "COMPLETE";
  assert.match(validateCatalogue(invalid).join("\n"), /cryptoSuiteStatus must remain PENDING_HUMAN_SECURITY_REVIEW/);
});


test("httpSurface and error-code vocabularies reconcile against the real backend/parent-sdk source (FABLE-A017)", () => {
  assert.deepEqual(validateHttpSurfaceAgainstSource(catalogue, loadAuthoritySources()), []);
});

test("a route registered in source but missing from the catalogue is detected", () => {
  const invalid = clone(catalogue);
  invalid.httpSurface.routes = invalid.httpSurface.routes.filter((r) => r.path !== "/v1/runtime-sync/protection-status");
  assert.match(validateHttpSurfaceAgainstSource(invalid, loadAuthoritySources()).join("\n"), /registered in source but absent from catalogue.*protection-status/);
});

test("a catalogue route the source never registers is detected", () => {
  const invalid = clone(catalogue);
  invalid.httpSurface.routes.push({ method: "DELETE", path: "/v1/runtime-sync/fabricated", auth: "device-session" });
  assert.match(validateHttpSurfaceAgainstSource(invalid, loadAuthoritySources()).join("\n"), /declares a route the source does not register: DELETE \/v1\/runtime-sync\/fabricated/);
});

test("a phantom error code (declared but never emitted) is detected in both vocabularies", () => {
  const invalid = clone(catalogue);
  invalid.deviceSessionErrorCodes.push("PHANTOM_AUTH_CODE");
  invalid.outboundSubmitErrorCodes.push("BATCH_TOO_LARGE");
  const text = validateHttpSurfaceAgainstSource(invalid, loadAuthoritySources()).join("\n");
  assert.match(text, /phantom device-session error code: PHANTOM_AUTH_CODE/);
  assert.match(text, /phantom outbound error code: BATCH_TOO_LARGE/);
});

test("an emitted outcome the catalogue omits is detected", () => {
  const invalid = clone(catalogue);
  invalid.outboundSubmitErrorCodes = invalid.outboundSubmitErrorCodes.filter((c) => c !== "CONFLICT");
  assert.match(validateHttpSurfaceAgainstSource(invalid, loadAuthoritySources()).join("\n"), /emitted by source but absent from catalogue: CONFLICT/);
});
