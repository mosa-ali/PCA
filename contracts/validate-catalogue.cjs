"use strict";

const requiredEnvelopeFields = new Set([
  "protocolMajor", "protocolMinor", "messageId", "familyOpaqueId",
  "senderDeviceOpaqueId", "senderKeyId", "messageType", "trustSetEpoch",
  "keyEpoch", "issuedAtUtc", "expiresAtUtc", "semanticVersion",
  "encryptedPayload", "signature"
]);
const requiredAlternativeGroups = [
  ["recipientDeviceOpaqueId", "recipientGroup"],
  ["senderSequence", "replayNonce"]
];
const permittedMessageTypes = new Set([
  "POLICY_UPDATE", "POLICY_RECEIPT", "STATUS_SNAPSHOT", "ACTIVITY_SUMMARY",
  "LOCATION_RESPONSE", "CHILD_REQUEST", "PARENT_DECISION", "TAMPER_ALERT",
  "RETENTION_DELETION_INSTRUCTION", "RETENTION_RECEIPT", "FTS_UPDATE",
  "KEY_ROTATION", "DEVICE_REVOKE", "RECOVERY_TRANSACTION", "SIGNED_ROLLBACK"
]);
const forbiddenCapabilities = new Set([
  "read-family-plaintext", "store-readable-family-history", "search-family-content",
  "sign-family-policy", "plaintext-diagnostics"
]);

function validateCatalogue(catalogue) {
  const errors = [];
  if (catalogue.representation !== "neutral") errors.push("catalogue must remain representation neutral");
  const envelope = catalogue.familyEnvelope || {};
  const fields = new Set(envelope.requiredLogicalFields || []);
  for (const field of requiredEnvelopeFields) if (!fields.has(field)) errors.push(`missing logical envelope field: ${field}`);
  for (const expected of requiredAlternativeGroups) {
    const found = (envelope.exclusiveAlternativeGroups || []).some((group) =>
      group.length === expected.length && expected.every((field) => group.includes(field))
    );
    if (!found) errors.push(`missing exclusive logical field group: ${expected.join(" | ")}`);
  }
  if (envelope.signatureCoverage !== "all-preceding-envelope-logical-fields") errors.push("signature coverage is incomplete");
  if (envelope.payload !== "opaque-authenticated-encrypted") errors.push("payload must remain opaque authenticated encryption");

  const seen = new Set();
  for (const message of catalogue.messageTypes || []) {
    if (!message.type || !message.route || !message.retentionClass || !message.idempotency) errors.push("message type lacks required logical metadata");
    if (seen.has(message.type)) errors.push(`duplicate message type: ${message.type}`);
    seen.add(message.type);
    if (!permittedMessageTypes.has(message.type)) errors.push(`unrecognised message type: ${message.type}`);
  }
  for (const type of permittedMessageTypes) if (!seen.has(type)) errors.push(`documented message type missing: ${type}`);

  const listedForbidden = new Set((catalogue.serviceControlPlane || {}).forbiddenCapabilities || []);
  for (const forbidden of forbiddenCapabilities) if (!listedForbidden.has(forbidden)) errors.push(`missing central-service prohibition: ${forbidden}`);
  const logicalFunctions = new Set((catalogue.serviceControlPlane || {}).logicalFunctions || []);
  for (const prohibited of ["family-history", "activity-history", "search", "diagnostics", "remote-command"]) {
    if (logicalFunctions.has(prohibited)) errors.push(`forbidden readable family-history service surface: ${prohibited}`);
  }
  return errors;
}

module.exports = { validateCatalogue };
