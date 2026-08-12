// Local, non-cryptographic verification of a received Family Trust Set
// (FTS). This does NOT verify the FTS's signature (that belongs to the
// not-yet-reviewed crypto suite) -- it only checks facts a browser can and
// must check before ever treating an FTS as authorizing decryption:
// epoch freshness, expiry, and whether this endpoint is revoked/authorized.
import type { FamilyTrustSet, FtsVerificationResult } from './types.js';

export interface FtsVerificationInput {
  fts: FamilyTrustSet;
  /** The highest FTS epoch this endpoint has previously accepted -- a new FTS at or below this epoch is stale (a replay/rollback, whether malicious or a stale relay cache). */
  acceptedMinEpoch: number | null;
  localEndpointId: string;
  nowUtc: Date;
}

export function verifyFamilyTrustSet(input: FtsVerificationInput): FtsVerificationResult {
  const { fts, acceptedMinEpoch, localEndpointId, nowUtc } = input;

  if (acceptedMinEpoch !== null && fts.epoch < acceptedMinEpoch) {
    return {
      ok: false,
      code: 'STALE_EPOCH',
      reason: `Received FTS epoch ${fts.epoch} is older than the last accepted epoch ${acceptedMinEpoch} -- rejecting as stale.`,
    };
  }

  const expiresAt = Date.parse(fts.expiresAtUtc);
  if (Number.isNaN(expiresAt) || nowUtc.getTime() >= expiresAt) {
    return {
      ok: false,
      code: 'EXPIRED',
      reason: `FTS expired at ${fts.expiresAtUtc} (checked at ${nowUtc.toISOString()}).`,
    };
  }

  if (fts.revokedEndpointIds.includes(localEndpointId)) {
    return {
      ok: false,
      code: 'ENDPOINT_REVOKED',
      reason: `This endpoint (${localEndpointId}) is listed as revoked in FTS epoch ${fts.epoch}.`,
    };
  }

  if (!fts.authorizedEndpointIds.includes(localEndpointId)) {
    return {
      ok: false,
      code: 'ENDPOINT_NOT_AUTHORIZED',
      reason: `This endpoint (${localEndpointId}) is not listed as authorized in FTS epoch ${fts.epoch}.`,
    };
  }

  return { ok: true, code: 'CURRENT', reason: `FTS epoch ${fts.epoch} is current and this endpoint is authorized.` };
}
