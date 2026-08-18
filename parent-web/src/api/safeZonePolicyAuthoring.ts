import type { NewSafeZoneInput } from './interfaces';

export interface SafeZonePlaintextDefinition {
  label: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  enabled: boolean;
}

export type SafeZonePolicyAuthoringErrorCode = 'CRYPTO_REVIEW_REQUIRED' | 'ENCRYPTION_UNAVAILABLE' | 'INVALID_DEFINITION';

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

/** Deliberate fail-closed adapter until the reviewed family crypto suite is available. */
export class UnavailableSafeZonePolicyAuthoring implements SafeZonePolicyAuthoring {
  constructor(private readonly code: SafeZonePolicyAuthoringErrorCode = 'CRYPTO_REVIEW_REQUIRED') {}

  async encrypt(_familyId: string, _recipientEndpointId: string, definition: SafeZonePlaintextDefinition): Promise<NewSafeZoneInput> {
    validateSafeZonePlaintextDefinition(definition);
    throw new SafeZonePolicyAuthoringError(this.code);
  }
}
