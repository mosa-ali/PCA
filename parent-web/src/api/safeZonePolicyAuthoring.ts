import type { NewSafeZoneInput, SafeZonePatch } from './interfaces';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface SafeZonePlaintextDefinition {
  label: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  enabled: boolean;
}

export type SafeZonePolicyAuthoringErrorCode =
  | 'CRYPTO_REVIEW_REQUIRED'
  | 'ENCRYPTION_UNAVAILABLE'
  | 'INVALID_DEFINITION'
  | 'FAMILY_AUTHORITY_REQUIRED';

export class SafeZonePolicyAuthoringError extends Error {
  constructor(readonly code: SafeZonePolicyAuthoringErrorCode) {
    super(code);
    this.name = 'SafeZonePolicyAuthoringError';
  }
}

/**
 * Validates readable input while it is still inside the parent-only boundary.
 * This does not encrypt, persist, log, or send the definition; it only avoids
 * passing malformed plaintext to a future reviewed family-crypto adapter.
 */
export function validateSafeZonePlaintextDefinition(definition: SafeZonePlaintextDefinition): void {
  if (
    typeof definition.label !== 'string' ||
    definition.label.trim().length === 0 ||
    definition.label.length > 256 ||
    typeof definition.enabled !== 'boolean' ||
    !Number.isFinite(definition.latitude) ||
    definition.latitude < -90 ||
    definition.latitude > 90 ||
    !Number.isFinite(definition.longitude) ||
    definition.longitude < -180 ||
    definition.longitude > 180 ||
    !Number.isFinite(definition.radiusMeters) ||
    definition.radiusMeters <= 0
  ) {
    throw new SafeZonePolicyAuthoringError('INVALID_DEFINITION');
  }
}

const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;
const OPAQUE_BASE64 = /^[A-Za-z0-9_-]{2,87380}$/;

/**
 * The backend Safe Zone endpoint is intentionally an opaque envelope store.
 * Keep this check at the parent-side crypto boundary too: a faulty or
 * malicious crypto adapter must not smuggle readable policy fields into the
 * service request, and the returned recipient must remain bound to the
 * endpoint the family authority approved.
 */
export function validateOpaqueSafeZoneInput(
  value: unknown,
  expectedRecipientEndpointId: string,
): asserts value is NewSafeZoneInput {
  if (!isRecord(value)) throw new SafeZonePolicyAuthoringError('ENCRYPTION_UNAVAILABLE');
  const keys = Object.keys(value).sort();
  if (keys.join('|') !== 'ciphertextB64|keyEpoch|nonceB64|recipientEndpointId') {
    throw new SafeZonePolicyAuthoringError('ENCRYPTION_UNAVAILABLE');
  }
  if (
    value.recipientEndpointId !== expectedRecipientEndpointId ||
    typeof value.recipientEndpointId !== 'string' ||
    !OPAQUE_TOKEN.test(value.recipientEndpointId) ||
    typeof value.ciphertextB64 !== 'string' ||
    !OPAQUE_BASE64.test(value.ciphertextB64) ||
    typeof value.nonceB64 !== 'string' ||
    !/^[A-Za-z0-9_-]{16,86}$/.test(value.nonceB64) ||
    typeof value.keyEpoch !== 'number' ||
    !Number.isInteger(value.keyEpoch) ||
    value.keyEpoch <= 0
  ) {
    throw new SafeZonePolicyAuthoringError('ENCRYPTION_UNAVAILABLE');
  }
}

/** Runtime guard for PATCH calls: only opaque envelope fields may cross HTTP. */
export function validateOpaqueSafeZonePatch(value: unknown): asserts value is SafeZonePatch {
  if (!isRecord(value)) throw new SafeZonePolicyAuthoringError('ENCRYPTION_UNAVAILABLE');
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.some((key) => !['ciphertextB64', 'nonceB64', 'keyEpoch'].includes(key))) {
    throw new SafeZonePolicyAuthoringError('ENCRYPTION_UNAVAILABLE');
  }
  if (value.ciphertextB64 !== undefined && (typeof value.ciphertextB64 !== 'string' || !OPAQUE_BASE64.test(value.ciphertextB64))) {
    throw new SafeZonePolicyAuthoringError('ENCRYPTION_UNAVAILABLE');
  }
  if (value.nonceB64 !== undefined && (typeof value.nonceB64 !== 'string' || !/^[A-Za-z0-9_-]{16,86}$/.test(value.nonceB64))) {
    throw new SafeZonePolicyAuthoringError('ENCRYPTION_UNAVAILABLE');
  }
  if (value.keyEpoch !== undefined && (typeof value.keyEpoch !== 'number' || !Number.isSafeInteger(value.keyEpoch) || value.keyEpoch <= 0)) {
    throw new SafeZonePolicyAuthoringError('ENCRYPTION_UNAVAILABLE');
  }
}

/**
 * The only parent-side boundary allowed to accept readable Safe Zone input.
 * Implementations must encrypt locally and return only the opaque service
 * contract; PCA HTTP clients never receive the plaintext definition.
 */
export interface SafeZonePolicyAuthoring {
  encrypt(
    familyId: string,
    recipientEndpointId: string,
    definition: SafeZonePlaintextDefinition,
  ): Promise<NewSafeZoneInput>;
}

/**
 * Family authority is deliberately a separate seam from service login. A
 * coordinator-bound implementation must resolve the actor and recipient
 * against the verified family trust set, including role (Owner/Admin versus
 * Viewer), family membership, revocation, and the current trust epoch. All
 * failed lookups use the same DENY result so unknown and cross-family
 * recipients cannot become an enumeration oracle.
 */
export interface SafeZoneFamilyAuthority {
  authorizePolicyMutation(input: {
    familyId: string;
    actorEndpointId: string;
    recipientEndpointId: string;
  }): Promise<'ALLOW' | 'DENY'>;
}

/**
 * Reviewed family encryption boundary. The production implementation is
 * intentionally injected: this source defines the exact plaintext-to-opaque
 * contract without selecting an unapproved KDF/AEAD/KEM construction.
 */
export interface SafeZoneFamilyEncryptionBoundary {
  encrypt(input: {
    familyId: string;
    actorEndpointId: string;
    recipientEndpointId: string;
    definition: SafeZonePlaintextDefinition;
  }): Promise<NewSafeZoneInput>;
}

export interface SafeZoneTrustedEndpointIdentity {
  getTrustedEndpointId(): Promise<string | null>;
}

/**
 * Parent-side controlled chain:
 * readable input -> validation -> verified family authority -> reviewed
 * encryption boundary -> opaque relay/storage contract.
 *
 * This class has no fallback that serializes the definition. If the endpoint
 * identity, family authority, or crypto boundary is unavailable, it rejects
 * before any network client can receive the plaintext.
 */
export class VerifiedFamilySafeZonePolicyAuthoring implements SafeZonePolicyAuthoring {
  constructor(
    private readonly identity: SafeZoneTrustedEndpointIdentity,
    private readonly authority: SafeZoneFamilyAuthority,
    private readonly encryption: SafeZoneFamilyEncryptionBoundary,
  ) {}

  async encrypt(
    familyId: string,
    recipientEndpointId: string,
    definition: SafeZonePlaintextDefinition,
  ): Promise<NewSafeZoneInput> {
    validateSafeZonePlaintextDefinition(definition);
    if (!OPAQUE_TOKEN.test(familyId) || !OPAQUE_TOKEN.test(recipientEndpointId)) {
      throw new SafeZonePolicyAuthoringError('FAMILY_AUTHORITY_REQUIRED');
    }

    const actorEndpointId = await this.identity.getTrustedEndpointId().catch(() => null);
    if (!actorEndpointId || !OPAQUE_TOKEN.test(actorEndpointId)) {
      throw new SafeZonePolicyAuthoringError('FAMILY_AUTHORITY_REQUIRED');
    }

    let decision: 'ALLOW' | 'DENY';
    try {
      decision = await this.authority.authorizePolicyMutation({ familyId, actorEndpointId, recipientEndpointId });
    } catch {
      decision = 'DENY';
    }
    if (decision !== 'ALLOW') {
      // One generic denial covers Viewer, unknown, revoked, and cross-family
      // actors/recipients. The browser never receives authority details.
      throw new SafeZonePolicyAuthoringError('FAMILY_AUTHORITY_REQUIRED');
    }

    const opaque = await this.encryption.encrypt({ familyId, actorEndpointId, recipientEndpointId, definition });
    validateOpaqueSafeZoneInput(opaque, recipientEndpointId);
    return opaque;
  }
}

/** Deliberate fail-closed adapter until the reviewed family crypto suite is available. */
export class UnavailableSafeZonePolicyAuthoring implements SafeZonePolicyAuthoring {
  constructor(private readonly code: SafeZonePolicyAuthoringErrorCode = 'CRYPTO_REVIEW_REQUIRED') {}

  async encrypt(_familyId: string, _recipientEndpointId: string, definition: SafeZonePlaintextDefinition): Promise<NewSafeZoneInput> {
    validateSafeZonePlaintextDefinition(definition);
    throw new SafeZonePolicyAuthoringError(this.code);
  }
}

/** Production default for the encryption seam. It never serializes or returns plaintext. */
export class UnavailableSafeZoneFamilyEncryptionBoundary implements SafeZoneFamilyEncryptionBoundary {
  async encrypt(_input: {
    familyId: string;
    actorEndpointId: string;
    recipientEndpointId: string;
    definition: SafeZonePlaintextDefinition;
  }): Promise<NewSafeZoneInput> {
    throw new SafeZonePolicyAuthoringError('CRYPTO_REVIEW_REQUIRED');
  }
}
