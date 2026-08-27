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
const OPAQUE_BASE64 = /^[A-Za-z0-9_-]{2,87380}$/;

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

/** The opaque service contract this authoring boundary must produce -- mirrors NewSafeZoneInput's shape, addressed to a specific child device rather than a generic recipient endpoint. */
export interface SchedulePolicyEnvelopeInput {
  recipientDeviceId: string;
  ciphertextB64: string;
  nonceB64: string;
  keyEpoch: number;
}

/** Keep the opaque-envelope check at the parent-side crypto boundary too, same rationale as validateOpaqueSafeZoneInput. */
export function validateOpaqueSchedulePolicyInput(value: unknown, expectedRecipientDeviceId: string): asserts value is SchedulePolicyEnvelopeInput {
  if (!isRecord(value)) throw new SchedulePolicyAuthoringError('ENCRYPTION_UNAVAILABLE');
  const keys = Object.keys(value).sort();
  if (keys.join('|') !== 'ciphertextB64|keyEpoch|nonceB64|recipientDeviceId') {
    throw new SchedulePolicyAuthoringError('ENCRYPTION_UNAVAILABLE');
  }
  if (
    value.recipientDeviceId !== expectedRecipientDeviceId ||
    typeof value.recipientDeviceId !== 'string' ||
    !OPAQUE_TOKEN.test(value.recipientDeviceId) ||
    typeof value.ciphertextB64 !== 'string' ||
    !OPAQUE_BASE64.test(value.ciphertextB64) ||
    typeof value.nonceB64 !== 'string' ||
    !/^[A-Za-z0-9_-]{16,86}$/.test(value.nonceB64) ||
    typeof value.keyEpoch !== 'number' ||
    !Number.isInteger(value.keyEpoch) ||
    value.keyEpoch <= 0
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
    validateOpaqueSchedulePolicyInput(envelope, recipientDeviceId);
    return this.transport.submit(familyId, definition.childProfileId, envelope);
  }
}

/** Same authority seam as SafeZoneFamilyAuthority -- a coordinator-bound implementation resolves the actor/recipient against the verified family trust set; every failed lookup collapses to the same DENY. */
export interface SchedulePolicyFamilyAuthority {
  authorizePolicyMutation(input: { familyId: string; actorEndpointId: string; childProfileId: string }): Promise<'ALLOW' | 'DENY'>;
}

/** Reviewed family encryption boundary -- intentionally injected, defines the plaintext-to-opaque contract without selecting an unapproved KDF/AEAD/KEM construction. This is also where a future implementer maps this plaintext definition onto the real SCHEDULE_POLICY_V1 wire bytes (see this file's header for the current mapping gap). */
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
    validateOpaqueSchedulePolicyInput(opaque, recipientDeviceId);
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
