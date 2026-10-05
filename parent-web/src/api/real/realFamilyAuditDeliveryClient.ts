// Real, HTTP-backed FamilyAuditDeliveryClient. Genuine networking code, not
// a stub: fetches this family's opaque audit-event envelopes from
// backend/src/http/routes/familyAuditEventRoutes.ts using the SAME
// actor-device-session-token binding as RealSafeZoneClient (see that file's
// own doc comment for the full ceremony rationale), then hands each
// envelope to the injected FamilyAuditEnvelopeDecryptionBoundary. See
// AUDIT_EVENT_MODEL in
// docs/product-completion/PCA_FAMILY_AUTHORITY_COMPLETION_ARCHITECTURE.md
// for why PENDING_TRUSTED_DECRYPTION covers "no trusted browser yet",
// unavailable envelope decryption, and incomplete feed evidence -- Audit.tsx
// must never turn any of these into a false empty-history claim.
import type { AuditTrailFeedResult, FamilyAuditDeliveryClient } from '../interfaces';
import type { FamilyAuditEnvelopeDecryptionBoundary, OpaqueFamilyAuditEnvelope } from '../familyAuditDecryption';
import { cookieSessionFamilyId } from './realBillingClient';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOpaqueEnvelope(value: unknown): value is OpaqueFamilyAuditEnvelope {
  return (
    isRecord(value) &&
    typeof value.envelopeId === 'string' &&
    typeof value.encryptedPayloadB64 === 'string' &&
    typeof value.nonceB64 === 'string' &&
    typeof value.keyEpoch === 'number' &&
    typeof value.generatedAtUtc === 'string'
  );
}

export class RealFamilyAuditDeliveryClient implements FamilyAuditDeliveryClient {
  private readonly decryption: FamilyAuditEnvelopeDecryptionBoundary;
  constructor(
    private readonly apiBaseUrl: string,
    decryptionOrLegacyAuthority: FamilyAuditEnvelopeDecryptionBoundary | unknown,
    legacyDecryption?: FamilyAuditEnvelopeDecryptionBoundary,
  ) {
    this.decryption = legacyDecryption ?? decryptionOrLegacyAuthority as FamilyAuditEnvelopeDecryptionBoundary;
  }

  private url(path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}${path}`;
  }

  async list(): Promise<AuditTrailFeedResult> {
    const familyId = await cookieSessionFamilyId(this.apiBaseUrl);
    if (!familyId) return { status: 'PENDING_TRUSTED_DECRYPTION' };

    let envelopes: OpaqueFamilyAuditEnvelope[];
    try {
      const response = await fetch(this.url(`/api/parent/families/${encodeURIComponent(familyId)}/audit-events`), {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return { status: 'PENDING_TRUSTED_DECRYPTION' };
      const body: unknown = await response.json();
      if (!isRecord(body) || !Array.isArray(body.envelopes) || !body.envelopes.every(isOpaqueEnvelope)) {
        return { status: 'PENDING_TRUSTED_DECRYPTION' };
      }
      envelopes = body.envelopes;
    } catch {
      return { status: 'PENDING_TRUSTED_DECRYPTION' };
    }

    if (envelopes.length === 0) {
      // An empty transport response does not prove completeness: production
      // event production/envelope delivery may be unavailable. Keep the UI
      // pending until the backend can establish that the feed is complete.
      return { status: 'PENDING_TRUSTED_DECRYPTION' };
    }

    try {
      const entries = await Promise.all(envelopes.map((envelope) => this.decryption.decrypt(envelope)));
      return { status: 'READY', entries };
    } catch {
      // The decryption boundary itself is unavailable (CRYPTO_SUITE gate) --
      // report the whole list as pending, never a partial/silently-dropped result.
      return { status: 'PENDING_TRUSTED_DECRYPTION' };
    }
  }
}
