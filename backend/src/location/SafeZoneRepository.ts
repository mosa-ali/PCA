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

/** The accepted device authority required to commit a Parent Safe Zone mutation. */
export interface SafeZoneMutationAuthoritySnapshot {
  readonly familyId: string;
  /** Authenticated Parent identity whose live ADMINISTRATOR membership authorizes this mutation. */
  readonly parentAccountId: string;
  readonly trustSetEpoch: number;
  readonly keyEpoch: number;
  readonly actor: { readonly deviceId: string; readonly dskKeyId: string };
  readonly recipient: { readonly deviceId: string; readonly dskKeyId: string };
}

export interface SafeZoneRecipientPage {
  safeZones: SafeZone[];
  nextCursor: string | null;
}

export class SafeZoneError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'INVALID_INPUT') {
    super(code);
    this.name = 'SafeZoneError';
  }
}

/** The accepted head, device, or exact DSK changed before a Safe Zone mutation could persist. */
export class SafeZoneAuthorityChangedError extends Error {
  constructor() {
    super('Safe Zone device authority changed before persistence.');
    this.name = 'SafeZoneAuthorityChangedError';
  }
}

const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;
const OPAQUE_BASE64URL = /^[A-Za-z0-9_-]+$/;
const SAFE_ZONE_CURSOR_VERSION = 'v1';
export const MAX_SAFE_ZONE_CURSOR_BYTES = 160;

/**
 * Validate the opaque Safe Zone delivery cursor accepted by the HTTP route.
 * Raw opaque IDs are retained as a legacy format; repositories restart those
 * requests from page one because their epoch cannot be established.
 */
export function validateSafeZoneDeliveryCursor(cursor: unknown): asserts cursor is string | undefined {
  if (cursor === undefined) return;
  if (typeof cursor !== 'string' || cursor.length === 0 ||
    Buffer.byteLength(cursor, 'utf8') > MAX_SAFE_ZONE_CURSOR_BYTES ||
    !/^[A-Za-z0-9_~-]+$/.test(cursor)) {
    throw new SafeZoneError('INVALID_INPUT');
  }

  if (!cursor.includes('~')) {
    if (!OPAQUE_TOKEN.test(cursor)) throw new SafeZoneError('INVALID_INPUT');
    return;
  }

  const parts = cursor.split('~');
  if (parts.length !== 3 || parts[0] !== SAFE_ZONE_CURSOR_VERSION ||
    !/^[1-9][0-9]*$/.test(parts[1]!) || !OPAQUE_TOKEN.test(parts[2]!)) {
    throw new SafeZoneError('INVALID_INPUT');
  }
  const cursorEpoch = Number(parts[1]);
  if (!isFamilyEpochNumber(cursorEpoch, 1)) throw new SafeZoneError('INVALID_INPUT');
}

/**
 * Resolve an input cursor against the current accepted family-key epoch.
 * Legacy IDs and valid cursors for an older epoch restart at page one; only a
 * cursor bound to the exact current epoch advances after its zone ID.
 */
export function safeZoneCursorAfterZoneId(cursor: string | undefined, currentKeyEpoch: number): string | undefined {
  validateSafeZoneDeliveryCursor(cursor);
  if (!isFamilyEpochNumber(currentKeyEpoch, 1)) throw new SafeZoneError('INVALID_INPUT');
  if (cursor === undefined || !cursor.includes('~')) return undefined;

  const [, cursorEpochText, lastZoneId] = cursor.split('~');
  return Number(cursorEpochText) === currentKeyEpoch ? lastZoneId : undefined;
}

/** Encode the last row as a cursor that is safe to continue only in this epoch. */
export function createSafeZoneDeliveryCursor(keyEpoch: number, lastZoneId: string): string {
  if (!isFamilyEpochNumber(keyEpoch, 1) || !OPAQUE_TOKEN.test(lastZoneId)) {
    throw new SafeZoneError('INVALID_INPUT');
  }
  const cursor = `${SAFE_ZONE_CURSOR_VERSION}~${keyEpoch}~${lastZoneId}`;
  if (Buffer.byteLength(cursor, 'utf8') > MAX_SAFE_ZONE_CURSOR_BYTES) throw new SafeZoneError('INVALID_INPUT');
  return cursor;
}

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
  /** Encrypted envelopes addressed to one authenticated device and its current accepted family-key epoch. The caller must derive all three values from a verified device session and accepted Trust Set projection. */
  listForRecipient(familyId: string, recipientEndpointId: string, keyEpoch: number, cursor?: string): Promise<SafeZoneRecipientPage>;
  create(input: NewSafeZone, authority?: SafeZoneMutationAuthoritySnapshot): Promise<SafeZone>;
  update(familyId: string, zoneId: string, patch: SafeZonePatch, authority?: SafeZoneMutationAuthoritySnapshot): Promise<SafeZone>;
  remove(familyId: string, zoneId: string, authority?: SafeZoneMutationAuthoritySnapshot): Promise<boolean>;
}
