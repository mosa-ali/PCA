"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const catalogue = require("../catalogue.json");
const { validateCatalogue } = require("../validate-catalogue.cjs");

function clone(value) { return JSON.parse(JSON.stringify(value)); }

test("child-profile-scope catalogue validates against the doc-39 foundation", () => {
  assert.deepEqual(validateCatalogue(catalogue), []);
});

test("MEMBER_OF_FAMILY declared as a denying status is rejected", () => {
  const invalid = clone(catalogue);
  invalid.denyingStatuses.push("MEMBER_OF_FAMILY");
  assert.match(validateCatalogue(invalid).join("\n"), /MEMBER_OF_FAMILY must never be a denying status/);
});

test("a distinct public deny reason per status is rejected (error oracle)", () => {
  const invalid = clone(catalogue);
  invalid.publicDenyReason.distinctReasonPerStatus = "allowed";
  assert.match(validateCatalogue(invalid).join("\n"), /distinct public reason per denying status must remain forbidden/);
});

test("dropping UNAVAILABLE from the oracle-covered reasons is rejected", () => {
  const invalid = clone(catalogue);
  invalid.publicDenyReason.appliesTo = invalid.publicDenyReason.appliesTo.filter((r) => r !== "UNAVAILABLE");
  assert.match(validateCatalogue(invalid).join("\n"), /public deny reason must cover: UNAVAILABLE/);
});

test("no-resolver-injected defaulting to ALLOW-shaped behavior is rejected", () => {
  const invalid = clone(catalogue);
  invalid.defaultResolverBehavior.noResolverInjected = "MEMBER_OF_FAMILY";
  assert.match(validateCatalogue(invalid).join("\n"), /no-resolver-injected must resolve to UNAVAILABLE/);
});

test("declaring a readable central child-profile directory as permitted is rejected", () => {
  const invalid = clone(catalogue);
  invalid.centralDirectory.readableCentralChildProfileDirectory = "permitted";
  assert.match(validateCatalogue(invalid).join("\n"), /readable central child-profile directory must remain forbidden/);
});

test("treating a client-asserted familyId as proof is rejected", () => {
  const invalid = clone(catalogue);
  invalid.familyIdSource.clientAssertedFamilyIdAsProof = "allowed";
  assert.match(validateCatalogue(invalid).join("\n"), /client-asserted familyId must never be treated as proof/);
});

test("caching membership inside the authorization service is rejected", () => {
  const invalid = clone(catalogue);
  invalid.reEvaluationFreshness.membershipCachedByAuthorizationService = true;
  assert.match(validateCatalogue(invalid).join("\n"), /must not cache membership itself/);
});

test("trusting queue-time state on reconnect is rejected", () => {
  const invalid = clone(catalogue);
  invalid.offlineReconnect.queueTimeStateTrusted = true;
  assert.match(validateCatalogue(invalid).join("\n"), /queue-time state must never be trusted as-is/);
});

test("dropping targetMembership from offline/reconnect re-validation is rejected", () => {
  const invalid = clone(catalogue);
  invalid.offlineReconnect.revalidatedFields = invalid.offlineReconnect.revalidatedFields.filter((f) => f !== "targetMembership");
  assert.match(validateCatalogue(invalid).join("\n"), /offline\/reconnect re-validation must cover: targetMembership/);
});

test("step-up overriding family scope is rejected", () => {
  const invalid = clone(catalogue);
  invalid.stepUpInteraction.stepUpCanOverrideFamilyScope = true;
  assert.match(validateCatalogue(invalid).join("\n"), /step-up must never be able to override family scope/);
});

test("dropping targetScopeId from the idempotency fingerprint is rejected", () => {
  const invalid = clone(catalogue);
  invalid.idempotency.requestFingerprintFields = invalid.idempotency.requestFingerprintFields.filter((f) => f !== "targetScopeId");
  assert.match(validateCatalogue(invalid).join("\n"), /request fingerprint must include: targetScopeId/);
});

test("a mutated target riding a cached outcome under the same key pair is rejected", () => {
  const invalid = clone(catalogue);
  invalid.idempotency.mutatedTargetUnderSameKeyPair = "return-cached-outcome";
  assert.match(validateCatalogue(invalid).join("\n"), /mutated target under the same idempotencyKey\/actionId pair must be re-evaluated fresh/);
});

test("self-approval declared possible is rejected", () => {
  const invalid = clone(catalogue);
  invalid.childRequestPaths.selfApprovalPossible = true;
  assert.match(validateCatalogue(invalid).join("\n"), /self-approval must remain impossible/);
});

test("synthetic fixtures stay non-sensitive opaque placeholders", () => {
  const syntheticFixture = {
    childProfileId: "synthetic-child-opaque-001",
    familyId: "synthetic-family-opaque-001",
    actorDeviceId: "synthetic-device-opaque-001"
  };
  const joined = JSON.stringify(syntheticFixture).toLowerCase();
  for (const forbidden of ["private key", "recovery secret", "latitude", "longitude", "http://", "https://", "@"])
    assert.equal(joined.includes(forbidden), false, `fixture must not contain ${forbidden}`);
});
