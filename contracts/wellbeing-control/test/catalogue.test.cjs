"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const catalogue = require("../catalogue.json");
const { validateCatalogue } = require("../validate-catalogue.cjs");

function clone(value) { return JSON.parse(JSON.stringify(value)); }

test("wellbeing-control catalogue validates against the doc-36 foundation", () => {
  assert.deepEqual(validateCatalogue(catalogue), []);
});

test("missing policy document field is rejected", () => {
  const invalid = clone(catalogue);
  invalid.policyDocument.requiredTopLevelFields = invalid.policyDocument.requiredTopLevelFields.filter((f) => f !== "policyRevision");
  assert.match(validateCatalogue(invalid).join("\n"), /missing policy document field: policyRevision/);
});

test("unrecognised category is rejected", () => {
  const invalid = clone(catalogue);
  invalid.categories.push("PUNITIVE_STREAK");
  assert.match(validateCatalogue(invalid).join("\n"), /unrecognised category: PUNITIVE_STREAK/);
});

test("unrecognised trigger is rejected", () => {
  const invalid = clone(catalogue);
  invalid.triggers.push("ALWAYS_ON");
  assert.match(validateCatalogue(invalid).join("\n"), /unrecognised trigger: ALWAYS_ON/);
});

test("full-screen delivery surface sneaking into the permitted list is rejected", () => {
  const invalid = clone(catalogue);
  invalid.deliverySurfaces.permitted.push("FULL_SCREEN_MESSAGE");
  assert.match(validateCatalogue(invalid).join("\n"), /forbidden delivery surface present in permitted list: FULL_SCREEN_MESSAGE/);
});

test("dropping the forbidden-surface declaration is rejected", () => {
  const invalid = clone(catalogue);
  invalid.deliverySurfaces.forbidden = invalid.deliverySurfaces.forbidden.filter((s) => s !== "SYSTEM_SECURITY_ALERT_IMPERSONATION");
  assert.match(validateCatalogue(invalid).join("\n"), /missing declared-forbidden delivery surface: SYSTEM_SECURITY_ALERT_IMPERSONATION/);
});

test("zero-second cooldown floor is rejected", () => {
  const invalid = clone(catalogue);
  invalid.frequencyBounds.repeatCooldownMinutesFloor = 0;
  assert.match(validateCatalogue(invalid).join("\n"), /repeatCooldownMinutesFloor must be a positive floor/);
});

test("unbounded nag-intensity ceiling is rejected", () => {
  const invalid = clone(catalogue);
  invalid.frequencyBounds.maximumPerDayCeiling = 500;
  assert.match(validateCatalogue(invalid).join("\n"), /maximumPerDayCeiling must be a bounded positive ceiling/);
});

test("adult-supervision rule must force lockScreenAllowed=false", () => {
  const invalid = clone(catalogue);
  invalid.adultSupervisionRule.whenRequiresAdultSupervisionIsTrue.lockScreenAllowedMustBe = true;
  assert.match(validateCatalogue(invalid).join("\n"), /adult-supervision rule must force lockScreenAllowed=false/);
});

test("localized text used as revision identity is rejected", () => {
  const invalid = clone(catalogue);
  invalid.revisionModel.localizedTextAsRevisionIdentity = "allowed";
  assert.match(validateCatalogue(invalid).join("\n"), /localized text must never be revision identity/);
});

test("declaring the central plaintext table as permitted is rejected", () => {
  const invalid = clone(catalogue);
  invalid.e2eeBoundary.centralPlaintextCustomMessageTable = "permitted";
  assert.match(validateCatalogue(invalid).join("\n"), /central plaintext custom-message table must remain forbidden/);
});

test("service visibility leaking message text is rejected", () => {
  const invalid = clone(catalogue);
  invalid.e2eeBoundary.serviceVisibility.push("message-text");
  assert.match(validateCatalogue(invalid).join("\n"), /service must not be declared visible to: message-text/);
});

test("missing forbidden coercive pattern is rejected", () => {
  const invalid = clone(catalogue);
  invalid.forbiddenCoercivePatterns = invalid.forbiddenCoercivePatterns.filter((p) => p !== "punitive-streaks");
  assert.match(validateCatalogue(invalid).join("\n"), /missing forbidden coercive pattern: punitive-streaks/);
});

test("synthetic fixtures stay non-sensitive opaque placeholders", () => {
  const syntheticFixture = {
    policyId: "synthetic-policy-0001",
    familyScopeRef: "synthetic-family-opaque-001",
    messageId: "synthetic-message-opaque-001",
    actorMemberId: "synthetic-member-opaque-001"
  };
  const joined = JSON.stringify(syntheticFixture).toLowerCase();
  for (const forbidden of ["private key", "recovery secret", "latitude", "longitude", "http://", "https://", "@"])
    assert.equal(joined.includes(forbidden), false, `fixture must not contain ${forbidden}`);
});
