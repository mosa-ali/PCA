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

module.exports = { validateCatalogue };
