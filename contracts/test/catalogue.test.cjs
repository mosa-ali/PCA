"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const catalogue = require("../catalogue.json");
const { validateCatalogue } = require("../validate-catalogue.cjs");

function clone(value) { return JSON.parse(JSON.stringify(value)); }

test("contract catalogue validates against the logical document-22 foundation", () => {
  assert.deepEqual(validateCatalogue(catalogue), []);
});

test("duplicate message types are rejected", () => {
  const invalid = clone(catalogue);
  invalid.messageTypes.push(clone(invalid.messageTypes[0]));
  assert.match(validateCatalogue(invalid).join("\n"), /duplicate message type: POLICY_UPDATE/);
});

test("every required logical envelope field is represented", () => {
  const invalid = clone(catalogue);
  invalid.familyEnvelope.requiredLogicalFields = invalid.familyEnvelope.requiredLogicalFields.filter((field) => field !== "signature");
  assert.match(validateCatalogue(invalid).join("\n"), /missing logical envelope field: signature/);
});

test("readable server-side family-history surfaces are rejected", () => {
  const invalid = clone(catalogue);
  invalid.serviceControlPlane.logicalFunctions.push("activity-history");
  assert.match(validateCatalogue(invalid).join("\n"), /forbidden readable family-history service surface/);
});

test("synthetic fixtures are non-sensitive opaque placeholders", () => {
  const syntheticFixture = {
    messageId: "synthetic-message-0001",
    familyOpaqueId: "synthetic-family-opaque-001",
    senderDeviceOpaqueId: "synthetic-device-opaque-001",
    encryptedPayload: "synthetic-opaque-ciphertext-placeholder",
    signature: "synthetic-signature-placeholder"
  };
  const joined = JSON.stringify(syntheticFixture).toLowerCase();
  for (const forbidden of ["private key", "recovery secret", "latitude", "longitude", "http://", "https://", "@"])
    assert.equal(joined.includes(forbidden), false, `fixture must not contain ${forbidden}`);
});
