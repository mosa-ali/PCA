import { isFamilyEpochNumber } from '../familyepoch/bounds.js';

export type SafeZoneDeliveryState = 'PENDING_OFFLINE' | 'READY';

export interface SafeZone {
  zoneId: string;
  familyId: string;
  recipientEndpointId: string;
  ciphertextB64: string;
  nonceB64: string;
  keyEpoch: number;
  revision: number;
  deliveryState: SafeZoneDeliveryState;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface NewSafeZone {
  familyId: string;
  recipientEndpointId: string;
  ciphertextB64: string;
  nonceB64: string;
  keyEpoch: number;
}

export interface SafeZonePatch {
  ciphertextB64?: string;
  nonceB64?: string;
  keyEpoch?: number;
}

export class SafeZoneError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'INVALID_INPUT') {
    super(code);
    this.name = 'SafeZoneError';
  }
}

const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;
const OPAQUE_BASE64URL = /^[A-Za-z0-9_-]+$/;

function assertOpaqueToken(value: string): void {
  if (!OPAQUE_TOKEN.test(value)) throw new SafeZoneError('INVALID_INPUT');
}

function assertCanonicalBase64Url(value: string, minimumBytes: number, maximumBytes: number): void {
  if (!OPAQUE_BASE64URL.test(value)) throw new SafeZoneError('INVALID_INPUT');
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, 'base64url');
  } catch {
    throw new SafeZoneError('INVALID_INPUT');
  }
  if (decoded.length < minimumBytes || decoded.length > maximumBytes || decoded.toString('base64url') !== value) {
    throw new SafeZoneError('INVALID_INPUT');
  }
}

/** Repository-level defense in depth for the ciphertext-blind Safe Zone contract. */
export function validateNewSafeZone(input: NewSafeZone): void {
  assertOpaqueToken(input.familyId);
  assertOpaqueToken(input.recipientEndpointId);
  assertCanonicalBase64Url(input.ciphertextB64, 1, 65_535);
  assertCanonicalBase64Url(input.nonceB64, 12, 64);
  if (!isFamilyEpochNumber(input.keyEpoch, 1)) {
    throw new SafeZoneError('INVALID_INPUT');
  }
}

/** Validate a partial update without allowing a plaintext policy shape. */
export function validateSafeZonePatch(patch: SafeZonePatch): void {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) throw new SafeZoneError('INVALID_INPUT');
  const keys = Object.keys(patch);
  if (keys.length === 0 || keys.some((key) => !['ciphertextB64', 'nonceB64', 'keyEpoch'].includes(key))) {
    throw new SafeZoneError('INVALID_INPUT');
  }
  const hasCiphertext = patch.ciphertextB64 !== undefined;
  const hasNonce = patch.nonceB64 !== undefined;
  // Ciphertext and nonce form one authenticated-encryption payload. Updating
  // only one can persist a pair that was never produced together.
  if (hasCiphertext !== hasNonce) throw new SafeZoneError('INVALID_INPUT');
  // keyEpoch binds the ciphertext to its family-key generation. Changing
  // that binding without replacing the complete encrypted payload would
  // relabel old bytes as if they had been encrypted under another key.
  if (patch.keyEpoch !== undefined && !hasCiphertext) throw new SafeZoneError('INVALID_INPUT');
  if (patch.ciphertextB64 !== undefined) assertCanonicalBase64Url(patch.ciphertextB64, 1, 65_535);
  if (patch.nonceB64 !== undefined) assertCanonicalBase64Url(patch.nonceB64, 12, 64);
  if (patch.keyEpoch !== undefined && !isFamilyEpochNumber(patch.keyEpoch, 1)) {
    throw new SafeZoneError('INVALID_INPUT');
  }
}

export interface SafeZoneRepository {
  list(familyId: string): Promise<SafeZone[]>;
  create(input: NewSafeZone): Promise<SafeZone>;
  update(familyId: string, zoneId: string, patch: SafeZonePatch): Promise<SafeZone>;
  remove(familyId: string, zoneId: string): Promise<boolean>;
}
