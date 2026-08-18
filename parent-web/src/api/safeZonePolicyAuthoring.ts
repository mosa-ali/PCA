import type { NewSafeZoneInput } from './interfaces';

export interface SafeZonePlaintextDefinition {
  label: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  enabled: boolean;
}

export type SafeZonePolicyAuthoringErrorCode = 'CRYPTO_REVIEW_REQUIRED' | 'ENCRYPTION_UNAVAILABLE';

export class SafeZonePolicyAuthoringError extends Error {
  constructor(readonly code: SafeZonePolicyAuthoringErrorCode) {
    super(code);
    this.name = 'SafeZonePolicyAuthoringError';
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

  async encrypt(_familyId: string, _recipientEndpointId: string, _definition: SafeZonePlaintextDefinition): Promise<NewSafeZoneInput> {
    throw new SafeZonePolicyAuthoringError(this.code);
  }
}
