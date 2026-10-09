import { isCanonicalP256Signature } from '../deviceauth/P256DeviceSignatureVerifier.js';
import { isFamilyEpochNumber } from '../familyepoch/bounds.js';
import { decodeCanonicalTrustSetEpochBytes } from './decode.js';
import { isPlausibleOpaqueId } from './policy.js';
import type { TrustSetEpochAcceptanceService, TrustSetEpochAcceptanceRejectionReason } from './TrustSetEpochAcceptance.js';
import type { TrustSetEpochRecord } from './TrustSetEpochStore.js';
import type { FamilyTrustSetEpoch } from './types.js';

/** Scope must come from verified device-session authentication, never request body or Parent credentials. */
export interface OrdinaryTrustSetScope { familyId: string; deviceId: string }
export interface OrdinaryTrustSetRequest { canonicalEpochBase64: string; signatureBase64: string }
export interface AcceptedTrustSetEpochDto {
  canonicalEpochBase64: string;
  signatureBase64: string;
  signerDeviceId: string;
  signerKeyId: string;
  trustSetEpoch: number;
  keyEpoch: number;
}
export type OrdinaryTrustSetSubmitResult = {
  outcome: 'ACCEPTED' | 'IDEMPOTENT_MATCH';
  acceptedEpoch: AcceptedTrustSetEpochDto;
  acceptedHead: AcceptedTrustSetEpochDto;
};
export type OrdinaryTrustSetStatusResult = {
  outcome: 'ACCEPTED' | 'NOT_ACCEPTED' | 'CONFLICT';
  acceptedEpoch: AcceptedTrustSetEpochDto | null;
  acceptedHead: AcceptedTrustSetEpochDto;
};
export class OrdinaryTrustSetError extends Error {
  constructor(readonly code: 'INVALID_REQUEST' | 'NO_TRUST_SET' | 'DEVICE_NOT_ACTIVE' | 'OWNER_REQUIRED' |
    'GENESIS_NOT_ALLOWED' | 'FAMILY_MISMATCH' | 'CONFLICT' | 'REJECTED' | 'EPOCH_NOT_FOUND',
    readonly reason?: TrustSetEpochAcceptanceRejectionReason) {
    super(`ordinary_trust_set_${code.toLowerCase()}`);
    this.name = 'OrdinaryTrustSetError';
  }
}

const MAX_CANONICAL_BYTES = 262_144;
function snapshotScope(scope: OrdinaryTrustSetScope): OrdinaryTrustSetScope {
  if (!scope || !isPlausibleOpaqueId(scope.familyId) || !isPlausibleOpaqueId(scope.deviceId)) {
    throw new OrdinaryTrustSetError('INVALID_REQUEST');
  }
  return { familyId: scope.familyId, deviceId: scope.deviceId };
}
function strictBase64(value: unknown, maxBytes: number): Buffer {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4 * Math.ceil(maxBytes / 3) ||
      value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new OrdinaryTrustSetError('INVALID_REQUEST');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0 || bytes.length > maxBytes || bytes.toString('base64') !== value) {
    throw new OrdinaryTrustSetError('INVALID_REQUEST');
  }
  return bytes;
}

function parseRequest(input: unknown): { bytes: Buffer; signature: string; epoch: FamilyTrustSetEpoch } {
  if (input === null || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).sort().join(',') !== 'canonicalEpochBase64,signatureBase64') {
    throw new OrdinaryTrustSetError('INVALID_REQUEST');
  }
  const request = input as OrdinaryTrustSetRequest;
  const bytes = strictBase64(request.canonicalEpochBase64, MAX_CANONICAL_BYTES);
  const signatureBytes = strictBase64(request.signatureBase64, 64);
  const signature = signatureBytes.toString('base64url');
  if (!isCanonicalP256Signature(signature)) throw new OrdinaryTrustSetError('INVALID_REQUEST');
  try { return { bytes, signature, epoch: decodeCanonicalTrustSetEpochBytes(bytes) }; }
  catch { throw new OrdinaryTrustSetError('INVALID_REQUEST'); }
}

function dto(record: TrustSetEpochRecord): AcceptedTrustSetEpochDto {
  if (!isCanonicalP256Signature(record.signature)) throw new Error('Invalid persisted Trust Set signature encoding.');
  return { canonicalEpochBase64: record.signedEpochBytes.toString('base64'),
    signatureBase64: Buffer.from(record.signature, 'base64url').toString('base64'),
    signerDeviceId: record.signerDeviceId, signerKeyId: record.signerKeyId,
    trustSetEpoch: record.trustSetEpoch, keyEpoch: record.keyEpoch };
}

/**
 * Ordinary device-only ingress and lost-response reconciliation. Acceptance remains
 * the existing fully verified CAS flow; this facade never writes the epoch store.
 * Exact historical matches are acceptance receipts, never a rollback or new authority.
 * Production activation still requires independent cryptographic contract review.
 */
export class OrdinaryTrustSetService {
  constructor(private readonly acceptanceService: TrustSetEpochAcceptanceService) {}

  private async authorizedHead(scope: OrdinaryTrustSetScope, ownerOnly: boolean): Promise<TrustSetEpochRecord> {
    if (!scope || !isPlausibleOpaqueId(scope.familyId) || !isPlausibleOpaqueId(scope.deviceId)) {
      throw new OrdinaryTrustSetError('INVALID_REQUEST');
    }
    const head = await this.acceptanceService.readAcceptedHead(scope.familyId);
    if (head === null) throw new OrdinaryTrustSetError('NO_TRUST_SET');
    const epoch = decodeCanonicalTrustSetEpochBytes(head.signedEpochBytes);
    const member = epoch.entries.find((entry) => entry.deviceId === scope.deviceId);
    if (!member || member.status !== 'ACTIVE') throw new OrdinaryTrustSetError('DEVICE_NOT_ACTIVE');
    if (ownerOnly && member.role !== 'OWNER') throw new OrdinaryTrustSetError('OWNER_REQUIRED');
    return head;
  }

  async head(scope: OrdinaryTrustSetScope): Promise<AcceptedTrustSetEpochDto> {
    return dto(await this.authorizedHead(snapshotScope(scope), false));
  }

  /** Indexed signed predecessor lookup for client-verified, bounded chain catch-up. */
  async epoch(sourceScope: OrdinaryTrustSetScope, trustSetEpoch: number): Promise<AcceptedTrustSetEpochDto> {
    const scope = snapshotScope(sourceScope);
    if (!isFamilyEpochNumber(trustSetEpoch, 1)) throw new OrdinaryTrustSetError('INVALID_REQUEST');
    await this.authorizedHead(scope, false);
    const record = await this.acceptanceService.readAcceptedEpoch(scope.familyId, trustSetEpoch);
    if (record === null) throw new OrdinaryTrustSetError('EPOCH_NOT_FOUND');
    await this.authorizedHead(scope, false);
    return dto(record);
  }

  async status(sourceScope: OrdinaryTrustSetScope, input: unknown): Promise<OrdinaryTrustSetStatusResult> {
    const scope = snapshotScope(sourceScope);
    const request = parseRequest(input);
    if (request.epoch.familyId !== scope.familyId) throw new OrdinaryTrustSetError('FAMILY_MISMATCH');
    const head = await this.authorizedHead(scope, true);
    const accepted = await this.acceptanceService.readAcceptedEpoch(scope.familyId, request.epoch.trustSetEpoch);
    // A racing acceptance can advance the head, but never make an immutable record disappear.
    if (accepted === null) {
      if (request.epoch.trustSetEpoch === head.trustSetEpoch) throw new Error('Accepted head disappeared from indexed lookup.');
      return { outcome: 'NOT_ACCEPTED', acceptedEpoch: null, acceptedHead: dto(head) };
    }
    const exact = accepted.signedEpochBytes.equals(request.bytes) && accepted.signature === request.signature;
    return { outcome: exact ? 'ACCEPTED' : 'CONFLICT', acceptedEpoch: exact ? dto(accepted) : null,
      acceptedHead: dto(await this.authorizedHead(scope, true)) };
  }

  async submit(sourceScope: OrdinaryTrustSetScope, input: unknown, receivedAt = new Date()): Promise<OrdinaryTrustSetSubmitResult> {
    const scope = snapshotScope(sourceScope);
    const serverReceivedAt = new Date(receivedAt);
    const request = parseRequest(input);
    if (request.epoch.familyId !== scope.familyId) throw new OrdinaryTrustSetError('FAMILY_MISMATCH');
    if (request.epoch.trustSetEpoch < 2) throw new OrdinaryTrustSetError('GENESIS_NOT_ALLOWED');
    await this.authorizedHead(scope, true);
    const previous = await this.acceptanceService.readAcceptedEpoch(scope.familyId, request.epoch.trustSetEpoch);
    if (previous !== null) {
      if (!previous.signedEpochBytes.equals(request.bytes) || previous.signature !== request.signature) {
        throw new OrdinaryTrustSetError('CONFLICT');
      }
      return { outcome: 'IDEMPOTENT_MATCH', acceptedEpoch: dto(previous),
        acceptedHead: dto(await this.authorizedHead(scope, true)) };
    }
    const result = await this.acceptanceService.acceptCandidate({ familyId: scope.familyId,
      signedCanonicalBytes: request.bytes.toString('utf8'), signature: request.signature, receivedAt: serverReceivedAt,
      claimedSideMetadata: { signerDeviceId: scope.deviceId } });
    if (result.outcome === 'CONFLICT') throw new OrdinaryTrustSetError('CONFLICT');
    if (result.outcome === 'REJECTED') throw new OrdinaryTrustSetError('REJECTED', result.reason);
    const accepted = await this.acceptanceService.readAcceptedEpoch(scope.familyId, request.epoch.trustSetEpoch);
    if (accepted === null || !accepted.signedEpochBytes.equals(request.bytes) || accepted.signature !== request.signature) {
      throw new Error('Successful acceptance did not retain the exact request.');
    }
    return { outcome: result.outcome === 'ACCEPTED' ? 'ACCEPTED' : 'IDEMPOTENT_MATCH',
      acceptedEpoch: dto(accepted), acceptedHead: dto(await this.authorizedHead(scope, true)) };
  }
}
