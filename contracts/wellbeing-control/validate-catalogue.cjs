"use strict";

const requiredPolicyFields = new Set([
  "version", "policyId", "policyRevision", "familyScopeRef", "targets", "enabled",
  "selectedCuratedSuggestionIds", "customMessages", "createdAt", "updatedAt"
]);
const requiredTargetModes = new Set(["ONE_CHILD", "MULTIPLE_CHILDREN", "ALL_CHILDREN"]);
const requiredCategories = new Set([
  "SKILLS_AND_LEARNING", "READING", "FAITH_POSITIVE", "GRATITUDE", "GOOD_DEED",
  "FAMILY_HELP", "HOME_RESPONSIBILITY", "CREATIVITY", "MOVEMENT_RESET",
  "REST_AND_RESET", "OUTDOOR_OR_OFFSCREEN", "PLANNING_AND_ORGANIZATION", "CUSTOM"
]);
const requiredTriggers = new Set([
  "PERIODIC", "AFTER_UNLOCK", "RAPID_GAME_RETURN", "BREAK_STARTED", "BREAK_ACTIVE",
  "BREAK_COMPLETED", "LONG_SESSION_ENDED", "SCHEDULED_TIME", "CHILD_REQUESTED_IDEA"
]);
const requiredPermittedSurfaces = new Set([
  "IN_APP_SMALL_CARD", "STANDARD_NOTIFICATION", "LOCK_SCREEN_REDACTED",
  "NEXT_UNLOCK_SMALL_CARD", "BREAK_SHIELD_OPTIONAL_CARD"
]);
const forbiddenSurfaces = new Set([
  "FULL_SCREEN_MESSAGE", "SYSTEM_LOCKSCREEN_REPLACEMENT", "SYSTEM_SECURITY_ALERT_IMPERSONATION"
]);
const requiredCommandTypes = new Set([
  "CREATE_CUSTOM_MESSAGE", "UPDATE_CUSTOM_MESSAGE", "ARCHIVE_CUSTOM_MESSAGE",
  "RESTORE_CUSTOM_MESSAGE", "ENABLE_CURATED_MESSAGE", "DISABLE_CURATED_MESSAGE",
  "UPDATE_DELIVERY_POLICY", "UPDATE_TARGETS"
]);
const requiredForbiddenCoercivePatterns = new Set([
  "forced-devotional-completion", "forced-exercise", "body-weight-targets",
  "shaming-metrics", "leaderboards", "punitive-streaks"
]);

function validateCatalogue(catalogue) {
  const errors = [];
  if (catalogue.representation !== "neutral") errors.push("catalogue must remain representation neutral");
  if (catalogue.contractVersion !== 1) errors.push("contract version must be 1");

  const policyFields = new Set((catalogue.policyDocument || {}).requiredTopLevelFields || []);
  for (const field of requiredPolicyFields) if (!policyFields.has(field)) errors.push(`missing policy document field: ${field}`);

  const targetModes = new Set(catalogue.targetModes || []);
  for (const mode of requiredTargetModes) if (!targetModes.has(mode)) errors.push(`missing target mode: ${mode}`);

  const categories = new Set(catalogue.categories || []);
  for (const category of requiredCategories) if (!categories.has(category)) errors.push(`missing category: ${category}`);
  for (const category of categories) if (!requiredCategories.has(category)) errors.push(`unrecognised category: ${category}`);

  const triggers = new Set(catalogue.triggers || []);
  for (const trigger of requiredTriggers) if (!triggers.has(trigger)) errors.push(`missing trigger: ${trigger}`);
  for (const trigger of triggers) if (!requiredTriggers.has(trigger)) errors.push(`unrecognised trigger: ${trigger}`);

  const permitted = new Set((catalogue.deliverySurfaces || {}).permitted || []);
  for (const surface of requiredPermittedSurfaces) if (!permitted.has(surface)) errors.push(`missing permitted delivery surface: ${surface}`);
  for (const surface of permitted) if (forbiddenSurfaces.has(surface)) errors.push(`forbidden delivery surface present in permitted list: ${surface}`);

  const declaredForbidden = new Set((catalogue.deliverySurfaces || {}).forbidden || []);
  for (const surface of forbiddenSurfaces) if (!declaredForbidden.has(surface)) errors.push(`missing declared-forbidden delivery surface: ${surface}`);

  const commandTypes = new Set(catalogue.commandTypes || []);
  for (const command of requiredCommandTypes) if (!commandTypes.has(command)) errors.push(`missing command type: ${command}`);

  const lengthBounds = catalogue.lengthBounds || {};
  if (!(lengthBounds.titleMaxChars > 0 && lengthBounds.titleMaxChars <= 120)) errors.push("titleMaxChars must be a small positive bound");
  if (!(lengthBounds.bodyMaxChars > 0 && lengthBounds.bodyMaxChars <= 500)) errors.push("bodyMaxChars must be a small positive bound");

  const freq = catalogue.frequencyBounds || {};
  if (!(freq.minimumIntervalMinutesFloor > 0)) errors.push("minimumIntervalMinutesFloor must be a positive floor (no zero-second cooldowns)");
  if (!(freq.maximumPerDayCeiling > 0 && freq.maximumPerDayCeiling < 50)) errors.push("maximumPerDayCeiling must be a bounded positive ceiling (no unbounded/nag-intensity dial)");
  if (!(freq.repeatCooldownMinutesFloor > 0)) errors.push("repeatCooldownMinutesFloor must be a positive floor");

  const supervision = (catalogue.adultSupervisionRule || {}).whenRequiresAdultSupervisionIsTrue || {};
  if (supervision.lockScreenAllowedMustBe !== false) errors.push("adult-supervision rule must force lockScreenAllowed=false");
  if (supervision.prohibitUnattendedStandardNotification !== true) errors.push("adult-supervision rule must prohibit unattended standard notification");

  const revision = catalogue.revisionModel || {};
  if (revision.policyRevision !== "strictly-monotonic-integer") errors.push("policyRevision must be strictly-monotonic-integer");
  if (revision.staleUpdate !== "reject") errors.push("stale updates must be rejected");
  if (revision.localizedTextAsRevisionIdentity !== "forbidden") errors.push("localized text must never be revision identity");

  const forbiddenPatterns = new Set(catalogue.forbiddenCoercivePatterns || []);
  for (const pattern of requiredForbiddenCoercivePatterns) if (!forbiddenPatterns.has(pattern)) errors.push(`missing forbidden coercive pattern: ${pattern}`);

  const e2ee = catalogue.e2eeBoundary || {};
  if (e2ee.centralPlaintextCustomMessageTable !== "forbidden") errors.push("central plaintext custom-message table must remain forbidden");
  const serviceVisibility = new Set(e2ee.serviceVisibility || []);
  for (const forbiddenVisibility of ["message-text", "family-schedule", "faith-preference", "target-meaning"]) {
    if (serviceVisibility.has(forbiddenVisibility)) errors.push(`service must not be declared visible to: ${forbiddenVisibility}`);
  }
  if (!serviceVisibility.has("opaque-envelope-metadata") || !serviceVisibility.has("ciphertext")) {
    errors.push("service visibility must be exactly opaque-envelope-metadata and ciphertext");
  }

  return errors;
}

module.exports = { validateCatalogue };
