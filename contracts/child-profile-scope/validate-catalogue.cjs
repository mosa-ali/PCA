"use strict";

const requiredMembershipStatuses = new Set(["MEMBER_OF_FAMILY", "NOT_MEMBER", "NOT_FOUND", "UNAVAILABLE"]);
const requiredDenyingStatuses = new Set(["NOT_MEMBER", "NOT_FOUND", "UNAVAILABLE"]);
const requiredOracleReasons = new Set(["NOT_MEMBER", "NOT_FOUND", "UNAVAILABLE", "MALFORMED_TARGET_ID"]);
const requiredRevalidatedFields = new Set(["family", "actorRole", "targetMembership", "expiry", "trustSetEpoch", "stepUpFreshness"]);
const requiredFingerprintFields = new Set(["familyId", "actorDeviceId", "operation", "targetScopeKind", "targetScopeId"]);

function validateCatalogue(catalogue) {
  const errors = [];
  if (catalogue.representation !== "neutral") errors.push("catalogue must remain representation neutral");
  if (catalogue.contractVersion !== 1) errors.push("contract version must be 1");

  const statuses = new Set(catalogue.membershipStatuses || []);
  for (const status of requiredMembershipStatuses) if (!statuses.has(status)) errors.push(`missing membership status: ${status}`);
  for (const status of statuses) if (!requiredMembershipStatuses.has(status)) errors.push(`unrecognised membership status: ${status}`);

  if (catalogue.allowingStatus !== "MEMBER_OF_FAMILY") errors.push("the only allowing status must be MEMBER_OF_FAMILY");

  const denying = new Set(catalogue.denyingStatuses || []);
  for (const status of requiredDenyingStatuses) if (!denying.has(status)) errors.push(`missing denying status: ${status}`);
  if (denying.has("MEMBER_OF_FAMILY")) errors.push("MEMBER_OF_FAMILY must never be a denying status");

  const publicReason = catalogue.publicDenyReason || {};
  if (publicReason.value !== "CROSS_FAMILY_TARGET") errors.push("public deny reason must be CROSS_FAMILY_TARGET");
  const appliesTo = new Set(publicReason.appliesTo || []);
  for (const reasonCase of requiredOracleReasons) if (!appliesTo.has(reasonCase)) errors.push(`public deny reason must cover: ${reasonCase}`);
  if (publicReason.distinctReasonPerStatus !== "forbidden") errors.push("a distinct public reason per denying status must remain forbidden (error oracle)");

  const defaultBehavior = catalogue.defaultResolverBehavior || {};
  if (defaultBehavior.noResolverInjected !== "UNAVAILABLE") errors.push("no-resolver-injected must resolve to UNAVAILABLE");
  if (defaultBehavior.unavailableResolvesTo !== "DENY") errors.push("UNAVAILABLE must resolve to DENY");
  if (defaultBehavior.implicitAllowOnMissingResolver !== "forbidden") errors.push("implicit allow on missing resolver must remain forbidden");

  const centralDirectory = catalogue.centralDirectory || {};
  if (centralDirectory.readableCentralChildProfileDirectory !== "forbidden") {
    errors.push("a readable central child-profile directory must remain forbidden");
  }

  const familyIdSource = catalogue.familyIdSource || {};
  if (familyIdSource.trustedSource !== "actor-already-resolved-family") {
    errors.push("familyId used for the membership check must be the actor's already-resolved family");
  }
  if (familyIdSource.clientAssertedFamilyIdAsProof !== "forbidden") {
    errors.push("a client-asserted familyId must never be treated as proof");
  }

  const malformed = catalogue.malformedIdHandling || {};
  if (malformed.checkedBeforeResolverCall !== true) errors.push("malformed target ids must be rejected before the resolver is ever called");
  if (!(malformed.maxLength > 0)) errors.push("malformedIdHandling.maxLength must be a positive bound");

  const freshness = catalogue.reEvaluationFreshness || {};
  if (freshness.membershipCachedByAuthorizationService !== false) {
    errors.push("the authorization service must not cache membership itself");
  }
  if (freshness.consultedOnEveryAuthorizeCall !== true) errors.push("the resolver must be consulted on every authorize() call");

  const offline = catalogue.offlineReconnect || {};
  if (offline.authorityCheckedAt !== "application-time") errors.push("authority must be checked at application time, not queue time");
  if (offline.queueTimeStateTrusted !== false) errors.push("queue-time state must never be trusted as-is");
  const revalidated = new Set(offline.revalidatedFields || []);
  for (const field of requiredRevalidatedFields) if (!revalidated.has(field)) errors.push(`offline/reconnect re-validation must cover: ${field}`);

  const stepUp = catalogue.stepUpInteraction || {};
  if (stepUp.membershipCheckedBeforeStepUp !== true) errors.push("membership must be checked before step-up is consulted");
  if (stepUp.stepUpCanOverrideFamilyScope !== false) errors.push("step-up must never be able to override family scope");

  const idempotency = catalogue.idempotency || {};
  const cacheKeyFields = new Set(idempotency.cacheKeyFields || []);
  if (!cacheKeyFields.has("idempotencyKey") || !cacheKeyFields.has("actionId")) {
    errors.push("idempotency cache key must include both idempotencyKey and actionId");
  }
  if (idempotency.cacheValidityAlsoRequires !== "requestFingerprintMatch") {
    errors.push("cached idempotency outcomes must also require a request fingerprint match");
  }
  const fingerprintFields = new Set(idempotency.requestFingerprintFields || []);
  for (const field of requiredFingerprintFields) if (!fingerprintFields.has(field)) errors.push(`request fingerprint must include: ${field}`);
  if (idempotency.mutatedTargetUnderSameKeyPair !== "re-evaluate-fresh") {
    errors.push("a mutated target under the same idempotencyKey/actionId pair must be re-evaluated fresh");
  }
  if (idempotency.identicalReplayUnderSameKeyPair !== "return-cached-outcome") {
    errors.push("an identical replay under the same idempotencyKey/actionId pair must return the cached outcome");
  }

  const childRequestPaths = catalogue.childRequestPaths || {};
  if (childRequestPaths.decide !== "always-calls-authorize-with-caller-supplied-targetScope") {
    errors.push("decide() must always call authorize() with the caller-supplied targetScope");
  }
  if (childRequestPaths.selfApprovalPossible !== false) errors.push("self-approval must remain impossible");

  return errors;
}

module.exports = { validateCatalogue };
