// Parent-side authoring boundary for a SCHEDULE_POLICY_V1 Family Envelope
// update (screen-time continuous-use/break limits + per-app allow/deny and
// daily limits) -- mirrors safeZonePolicyAuthoring.ts's exact chain
// (readable input -> validation -> verified family authority -> reviewed
// encryption boundary -> opaque transport contract) so this package does
// not invent a second authoring pattern alongside Safe Zone's.
//
// KNOWN, HONEST SCOPE GAP (do not silently "complete" this without a
// design decision -- see docs/product-completion/PCA_FAMILY_AUTHORITY_COMPLETION_ARCHITECTURE.md):
// android/app/src/main/java/org/pca/app/runtime/schedule/SchedulePolicyEnvelopePayload.kt's
// real SCHEDULE_POLICY_V1 wire contract has no field corresponding to
// ScreenTimeStatus.continuousUseLimitMinutes/breakDurationMinutes anywhere
// (checked SchedulePolicy.kt, SchedulePolicyRules.kt, ScheduleEvaluator.kt --
// none model a continuous-use/mandatory-break concept). Nor does
// parent-web's current domain layer carry the Android contract's
// windows[]/bonusGrants[]/parentExceptions[]/policyId/trustSetEpoch/keyEpoch
// fields. This module therefore defines a plaintext definition shaped
// around what parent-web's domain model actually has today (continuous-
// use/break limits + per-app rules), NOT a byte-for-byte SCHEDULE_POLICY_V1
// mirror. The reviewed encryption boundary (SchedulePolicyFamilyEncryptionBoundary,
// still unimplemented pending PRODUCTION_CRYPTO_SUITE) is the seam
// responsible for the actual wire encoding once it exists -- exactly the
// same separation safeZonePolicyAuthoring.ts already uses (its plaintext
// definition is not the wire format either). Closing the
// continuous-use/break mapping gap for real device-side enforcement is a
// separate, not-yet-made product/contract decision, not a wiring task.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface AppRuleChange {
  appId: string;
  allowed: boolean;
  dailyLimitMinutes: number | null;
}

/** Exactly one of the two change kinds is present per submission -- ScreenTimePage.tsx and AppsPage.tsx each author one at a time, never both in a single envelope. */
export type SchedulePolicyPlaintextDefinition =
  | { kind: 'CONTINUOUS_USE_AND_BREAK'; childProfileId: string; continuousUseLimitMinutes: number; breakDurationMinutes: number }
  | { kind: 'APP_RULE'; childProfileId: string; appRule: AppRuleChange };

export type SchedulePolicyAuthoringErrorCode =
  | 'CRYPTO_REVIEW_REQUIRED'
  | 'ENCRYPTION_UNAVAILABLE'
  | 'INVALID_DEFINITION'
  | 'FAMILY_AUTHORITY_REQUIRED';

export class SchedulePolicyAuthoringError extends Error {
  constructor(readonly code: SchedulePolicyAuthoringErrorCode) {
    super(code);
    this.name = 'SchedulePolicyAuthoringError';
  }
}

const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;
// Shared family epoch protocol bound (INT32_MAX), matching backend and mobile.
const MAX_FAMILY_EPOCH = 2_147_483_647;

/** Validates readable input while it is still inside the parent-only boundary. Does not encrypt, persist, log, or send it. */
export function validateSchedulePolicyPlaintextDefinition(definition: SchedulePolicyPlaintextDefinition): void {
  if (!OPAQUE_TOKEN.test(definition.childProfileId)) throw new SchedulePolicyAuthoringError('INVALID_DEFINITION');
  if (definition.kind === 'CONTINUOUS_USE_AND_BREAK') {
    if (
      !Number.isInteger(definition.continuousUseLimitMinutes) ||
      definition.continuousUseLimitMinutes <= 0 ||
      !Number.isInteger(definition.breakDurationMinutes) ||
      definition.breakDurationMinutes <= 0
    ) {
      throw new SchedulePolicyAuthoringError('INVALID_DEFINITION');
    }
    return;
  }
  if (
    typeof definition.appRule.appId !== 'string' ||
    definition.appRule.appId.length === 0 ||
    definition.appRule.appId.length > 256 ||
    typeof definition.appRule.allowed !== 'boolean' ||
    (definition.appRule.dailyLimitMinutes !== null && (!Number.isInteger(definition.appRule.dailyLimitMinutes) || definition.appRule.dailyLimitMinutes < 0))
  ) {
    throw new SchedulePolicyAuthoringError('INVALID_DEFINITION');
  }
}

/** Full signed wire envelope accepted by backend/src/http/routes/childPolicyRoutes.ts.
 * This mirrors RawFamilyEnvelope with canonical wire encodings (ISO date
 * strings and base64 payload), bound to one device recipient. The Parent
 * transport does not create signatures or encrypt payloads; it only accepts
 * and forwards an envelope produced by the reviewed family-crypto boundary. */
export interface SchedulePolicyEnvelopeInput {
  protocolMajor: number;
  protocolMinor: number;
  messageId: string;
  familyId: string;
  senderDeviceId: string;
  recipientDeviceId: string;
  senderKeyId: string;
  messageType: 'POLICY_UPDATE';
  trustSetEpoch: number;
  keyEpoch: number;
  sequenceOrNonce: string;
  issuedAt: string;
  expiresAt: string;
  semanticVersion: string;
  correlationId?: string | null;
  payload: string;
  signature: string;
}

export interface SchedulePolicyEnvelopeBinding {
  familyId: string;
  senderDeviceId: string;
  recipientDeviceId: string;
}

const MAX_FAMILY_ENVELOPE_PAYLOAD_BYTES = 64 * 1024;
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const SEMANTIC_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const SCHEDULE_POLICY_ENVELOPE_KEYS = [
  'expiresAt', 'familyId', 'issuedAt', 'keyEpoch', 'messageId',
  'messageType', 'payload', 'protocolMajor', 'protocolMinor', 'recipientDeviceId',
  'semanticVersion', 'senderDeviceId', 'senderKeyId', 'sequenceOrNonce',
  'signature', 'trustSetEpoch',
];
const SCHEDULE_POLICY_ENVELOPE_KEYS_WITH_CORRELATION = [...SCHEDULE_POLICY_ENVELOPE_KEYS, 'correlationId'].sort();
const BASE64_VALUES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function isOpaqueId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function isCanonicalPayloadBase64(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 || !CANONICAL_BASE64.test(value)) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const decodedBytes = value.length / 4 * 3 - padding;
  if (decodedBytes < 1 || decodedBytes > MAX_FAMILY_ENVELOPE_PAYLOAD_BYTES) return false;
  if (padding === 2 && (BASE64_VALUES.indexOf(value[value.length - 3]!) & 0x0f) !== 0) return false;
  if (padding === 1 && (BASE64_VALUES.indexOf(value[value.length - 2]!) & 0x03) !== 0) return false;
  return true;
}

function isCanonicalIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

/** Validate the canonical opaque wire object before any transport call. This
 * intentionally rejects the former partial `{ciphertextB64, nonceB64,
 * keyEpoch}` body: it cannot be accepted by the signed FamilyEnvelope route
 * or be verified/replayed by the device-side protocol. */
export function validateOpaqueSchedulePolicyInput(
  value: unknown,
  expected: SchedulePolicyEnvelopeBinding,
): asserts value is SchedulePolicyEnvelopeInput {
  if (!isRecord(value)) throw new SchedulePolicyAuthoringError('ENCRYPTION_UNAVAILABLE');
  const keys = Object.keys(value).sort();
  const serializedKeys = keys.join('|');
  if (
    serializedKeys !== SCHEDULE_POLICY_ENVELOPE_KEYS.join('|') &&
    serializedKeys !== SCHEDULE_POLICY_ENVELOPE_KEYS_WITH_CORRELATION.join('|')
  ) {
    throw new SchedulePolicyAuthoringError('ENCRYPTION_UNAVAILABLE');
  }
  const issuedAt = isCanonicalIsoDate(value.issuedAt) ? new Date(value.issuedAt).getTime() : Number.NaN;
  const expiresAt = isCanonicalIsoDate(value.expiresAt) ? new Date(value.expiresAt).getTime() : Number.NaN;
  if (
    value.familyId !== expected.familyId ||
    value.senderDeviceId !== expected.senderDeviceId ||
    value.recipientDeviceId !== expected.recipientDeviceId ||
    typeof value.recipientDeviceId !== 'string' ||
    !isOpaqueId(value.familyId) ||
    !isOpaqueId(value.senderDeviceId) ||
    !isOpaqueId(value.recipientDeviceId) ||
    !isOpaqueId(value.senderKeyId) ||
    !isOpaqueId(value.messageId) ||
    !isOpaqueId(value.sequenceOrNonce) ||
    value.messageType !== 'POLICY_UPDATE' ||
    !Number.isSafeInteger(value.protocolMajor) || (value.protocolMajor as number) < 1 ||
    !Number.isSafeInteger(value.protocolMinor) || (value.protocolMinor as number) < 0 ||
    !Number.isSafeInteger(value.trustSetEpoch) || (value.trustSetEpoch as number) < 0 || (value.trustSetEpoch as number) > MAX_FAMILY_EPOCH ||
    !Number.isSafeInteger(value.keyEpoch) || (value.keyEpoch as number) < 0 || (value.keyEpoch as number) > MAX_FAMILY_EPOCH ||
    (value.correlationId !== undefined && value.correlationId !== null && !isOpaqueId(value.correlationId)) ||
    typeof value.semanticVersion !== 'string' || value.semanticVersion.length > 32 || !SEMANTIC_VERSION.test(value.semanticVersion) ||
    !isCanonicalPayloadBase64(value.payload) ||
    typeof value.signature !== 'string' || value.signature.length < 1 || value.signature.length > 512 ||
    !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt
  ) {
    throw new SchedulePolicyAuthoringError('ENCRYPTION_UNAVAILABLE');
  }
}

/** The only parent-side boundary allowed to accept a readable schedule-policy change. Implementations must encrypt locally and return only the opaque service contract. */
export interface SchedulePolicyAuthoring {
  encrypt(familyId: string, recipientDeviceId: string, definition: SchedulePolicyPlaintextDefinition): Promise<SchedulePolicyEnvelopeInput>;
}

export interface SchedulePolicySubmissionResult {
  status: 'PENDING';
  messageId: string;
}

export interface SchedulePolicyTransport {
  submit(familyId: string, childProfileId: string, envelope: SchedulePolicyEnvelopeInput): Promise<SchedulePolicySubmissionResult>;
}

/** Parent-side composition seam: plaintext handed only to the authoring boundary; the transport receives the validated opaque envelope and nothing else. */
export interface SchedulePolicyPublisher {
  publish(familyId: string, recipientDeviceId: string, definition: SchedulePolicyPlaintextDefinition): Promise<SchedulePolicySubmissionResult>;
}

export class VerifiedFamilySchedulePolicyPublisher implements SchedulePolicyPublisher {
  constructor(
    private readonly authoring: SchedulePolicyAuthoring,
    private readonly transport: SchedulePolicyTransport,
  ) {}

  async publish(familyId: string, recipientDeviceId: string, definition: SchedulePolicyPlaintextDefinition): Promise<SchedulePolicySubmissionResult> {
    const envelope = await this.authoring.encrypt(familyId, recipientDeviceId, definition);
    validateOpaqueSchedulePolicyInput(envelope, {
      familyId,
      senderDeviceId: envelope.senderDeviceId,
      recipientDeviceId,
    });
    return this.transport.submit(familyId, definition.childProfileId, envelope);
  }
}

/** Same authority seam as SafeZoneFamilyAuthority -- a coordinator-bound implementation resolves the actor/recipient against the verified family trust set; every failed lookup collapses to the same DENY. */
export interface SchedulePolicyFamilyAuthority {
  authorizePolicyMutation(input: { familyId: string; actorEndpointId: string; childProfileId: string }): Promise<'ALLOW' | 'DENY'>;
}

/** Reviewed family envelope boundary -- intentionally injected, accepts the
 * plaintext definition and returns the existing signed FamilyEnvelope wire
 * contract without selecting an unapproved KDF/AEAD/KEM/signature construction.
 * The separate plaintext-to-SchedulePolicyV1 field mapping remains unresolved. */
export interface SchedulePolicyFamilyEncryptionBoundary {
  encrypt(input: { familyId: string; actorEndpointId: string; recipientDeviceId: string; definition: SchedulePolicyPlaintextDefinition }): Promise<SchedulePolicyEnvelopeInput>;
}

export interface SchedulePolicyTrustedEndpointIdentity {
  getTrustedEndpointId(): Promise<string | null>;
}

/** Parent-side controlled chain: readable input -> validation -> verified family authority -> reviewed encryption boundary -> opaque transport contract. No fallback that serializes the definition anywhere along the way. */
export class VerifiedFamilySchedulePolicyAuthoring implements SchedulePolicyAuthoring {
  constructor(
    private readonly identity: SchedulePolicyTrustedEndpointIdentity,
    private readonly authority: SchedulePolicyFamilyAuthority,
    private readonly encryption: SchedulePolicyFamilyEncryptionBoundary,
  ) {}

  async encrypt(familyId: string, recipientDeviceId: string, definition: SchedulePolicyPlaintextDefinition): Promise<SchedulePolicyEnvelopeInput> {
    validateSchedulePolicyPlaintextDefinition(definition);
    if (!OPAQUE_TOKEN.test(familyId) || !OPAQUE_TOKEN.test(recipientDeviceId)) {
      throw new SchedulePolicyAuthoringError('FAMILY_AUTHORITY_REQUIRED');
    }

    const actorEndpointId = await this.identity.getTrustedEndpointId().catch(() => null);
    if (!actorEndpointId || !OPAQUE_TOKEN.test(actorEndpointId)) {
      throw new SchedulePolicyAuthoringError('FAMILY_AUTHORITY_REQUIRED');
    }

    let decision: 'ALLOW' | 'DENY';
    try {
      decision = await this.authority.authorizePolicyMutation({ familyId, actorEndpointId, childProfileId: definition.childProfileId });
    } catch {
      decision = 'DENY';
    }
    if (decision !== 'ALLOW') {
      throw new SchedulePolicyAuthoringError('FAMILY_AUTHORITY_REQUIRED');
    }

    const opaque = await this.encryption.encrypt({ familyId, actorEndpointId, recipientDeviceId, definition });
    validateOpaqueSchedulePolicyInput(opaque, { familyId, senderDeviceId: actorEndpointId, recipientDeviceId });
    return opaque;
  }
}

/** Deliberate fail-closed adapter until the reviewed family crypto suite is available. */
export class UnavailableSchedulePolicyAuthoring implements SchedulePolicyAuthoring {
  constructor(private readonly code: SchedulePolicyAuthoringErrorCode = 'CRYPTO_REVIEW_REQUIRED') {}

  async encrypt(_familyId: string, _recipientDeviceId: string, definition: SchedulePolicyPlaintextDefinition): Promise<SchedulePolicyEnvelopeInput> {
    validateSchedulePolicyPlaintextDefinition(definition);
    throw new SchedulePolicyAuthoringError(this.code);
  }
}

/** Production default for the encryption seam. Never serializes or returns plaintext. */
export class UnavailableSchedulePolicyFamilyEncryptionBoundary implements SchedulePolicyFamilyEncryptionBoundary {
  async encrypt(): Promise<SchedulePolicyEnvelopeInput> {
    throw new SchedulePolicyAuthoringError('CRYPTO_REVIEW_REQUIRED');
  }
}
