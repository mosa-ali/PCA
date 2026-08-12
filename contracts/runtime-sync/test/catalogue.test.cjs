"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const catalogue = require("../catalogue.json");
const { validateCatalogue } = require("../validate-catalogue.cjs");

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
