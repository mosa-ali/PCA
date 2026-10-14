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
import type { AuditEntrySummary } from '../../domain/types';
import type { FamilyAuditEnvelopeDecryptionBoundary, OpaqueFamilyAuditEnvelope } from '../familyAuditDecryption';
import type { TrustedBrowserProvider } from '../../domain/trustedBrowser';
import { cookieSessionFamilyId } from './realBillingClient';

const MAX_AUDIT_PAGE_SIZE = 500;
// The 21st request is reserved for the terminal `complete` confirmation
// after 20 full data pages have reached the 10,000-envelope processing cap.
const MAX_AUDIT_PAGES = 21;
const MAX_AUDIT_ENVELOPES = 10_000;
const MAX_AUDIT_CURSOR_LENGTH = 4096;
// Match the existing FamilyAudit producer, storage, and schema bounds. The
// payload column is ASCII mediumtext with a 4 MiB application limit; nonce is
// ASCII VARCHAR(64). Validate before retaining or handing response data to
// the decryption boundary.
const MAX_ENCRYPTED_PAYLOAD_LENGTH = 4_194_304;
const MAX_NONCE_LENGTH = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) return false;
  }
  return true;
}

function compareUtf8(left: string, right: string): number {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const sharedLength = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index]! - rightBytes[index]!;
  }
  return leftBytes.length - rightBytes.length;
}

function isOpaqueEnvelope(value: unknown): value is OpaqueFamilyAuditEnvelope {
  return (
    isRecord(value) &&
    typeof value.envelopeId === 'string' && value.envelopeId.length > 0 && value.envelopeId.length <= 256 &&
    typeof value.encryptedPayloadB64 === 'string' && value.encryptedPayloadB64.length > 0 &&
    value.encryptedPayloadB64.length <= MAX_ENCRYPTED_PAYLOAD_LENGTH && isAscii(value.encryptedPayloadB64) &&
    typeof value.nonceB64 === 'string' && value.nonceB64.length > 0 &&
    value.nonceB64.length <= MAX_NONCE_LENGTH && isAscii(value.nonceB64) &&
    typeof value.keyEpoch === 'number' && Number.isSafeInteger(value.keyEpoch) && value.keyEpoch > 0 &&
    typeof value.generatedAtUtc === 'string' && Number.isFinite(Date.parse(value.generatedAtUtc))
  );
}

interface AuditEnvelopePage {
  envelopes: OpaqueFamilyAuditEnvelope[];
  complete: boolean;
  nextCursor: string | null;
}

function parsePage(value: unknown): AuditEnvelopePage | null {
  if (!isRecord(value) || !Array.isArray(value.envelopes) || value.envelopes.length > MAX_AUDIT_PAGE_SIZE ||
    !value.envelopes.every(isOpaqueEnvelope) || typeof value.complete !== 'boolean') {
    return null;
  }
  if (value.complete) {
    if (value.nextCursor !== null || value.envelopes.length >= MAX_AUDIT_PAGE_SIZE) return null;
  } else if (typeof value.nextCursor !== 'string' || value.nextCursor.length === 0 ||
    value.nextCursor.length > MAX_AUDIT_CURSOR_LENGTH || value.envelopes.length !== MAX_AUDIT_PAGE_SIZE) {
    return null;
  }
  return {
    envelopes: value.envelopes,
    complete: value.complete,
    nextCursor: value.nextCursor as string | null,
  };
}

export class RealFamilyAuditDeliveryClient implements FamilyAuditDeliveryClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly trustedBrowser: TrustedBrowserProvider,
    private readonly decryption: FamilyAuditEnvelopeDecryptionBoundary,
  ) {}

  private url(path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}${path}`;
  }

  private async actorHeaders(): Promise<Record<string, string>> {
    const snapshot = await this.trustedBrowser.getSnapshot();
    if (snapshot.state !== 'TRUSTED' || !snapshot.browserEndpointId || !snapshot.actorDeviceSessionToken) {
      throw new Error('ACTOR_DEVICE_SESSION_UNAVAILABLE');
    }
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${snapshot.actorDeviceSessionToken}`,
    };
  }

  async list(): Promise<AuditTrailFeedResult> {
    const familyId = await cookieSessionFamilyId(this.apiBaseUrl);
    if (!familyId) return { status: 'PENDING_TRUSTED_DECRYPTION' };

    let actorHeaders: Record<string, string>;
    try {
      actorHeaders = await this.actorHeaders();
    } catch {
      return { status: 'PENDING_TRUSTED_DECRYPTION' };
    }

    const entries: AuditEntrySummary[] = [];
    const seenCursors = new Set<string>();
    const seenEnvelopeIds = new Set<string>();
    let previousGeneratedAt = Number.NEGATIVE_INFINITY;
    let previousEnvelopeId: string | null = null;
    let cursor: string | null = null;
    let complete = false;
    let envelopeCount = 0;
    try {
      for (let pageNumber = 0; pageNumber < MAX_AUDIT_PAGES; pageNumber += 1) {
        const basePath = `/api/parent/families/${encodeURIComponent(familyId)}/audit-events`;
        const path = cursor === null ? basePath : `${basePath}?${new URLSearchParams({ cursor }).toString()}`;
        const response = await fetch(this.url(path), {
          credentials: 'include',
          headers: actorHeaders,
        });
        if (!response.ok) return { status: 'PENDING_TRUSTED_DECRYPTION' };
        const page = parsePage(await response.json());
        if (!page) return { status: 'PENDING_TRUSTED_DECRYPTION' };
        if (!page.complete && page.envelopes.length === 0) return { status: 'PENDING_TRUSTED_DECRYPTION' };

        for (const envelope of page.envelopes) {
          const generatedAt = Date.parse(envelope.generatedAtUtc);
          if (generatedAt < previousGeneratedAt || seenEnvelopeIds.has(envelope.envelopeId) ||
            (generatedAt === previousGeneratedAt && previousEnvelopeId !== null &&
              compareUtf8(envelope.envelopeId, previousEnvelopeId) <= 0)) {
            return { status: 'PENDING_TRUSTED_DECRYPTION' };
          }
          previousGeneratedAt = generatedAt;
          previousEnvelopeId = envelope.envelopeId;
          seenEnvelopeIds.add(envelope.envelopeId);
        }
        if (envelopeCount + page.envelopes.length > MAX_AUDIT_ENVELOPES) {
          return { status: 'PENDING_TRUSTED_DECRYPTION' };
        }
        envelopeCount += page.envelopes.length;
        if (page.envelopes.length > 0) {
          // Decrypt each bounded page before fetching the next one. Only the
          // summaries remain in memory while pagination continues.
          entries.push(...await Promise.all(page.envelopes.map((envelope) => this.decryption.decrypt(envelope))));
        }
        if (page.complete) {
          complete = true;
          break;
        }

        const nextCursor = page.nextCursor!;
        if (nextCursor === cursor || seenCursors.has(nextCursor)) {
          return { status: 'PENDING_TRUSTED_DECRYPTION' };
        }
        seenCursors.add(nextCursor);
        cursor = nextCursor;
      }
    } catch {
      return { status: 'PENDING_TRUSTED_DECRYPTION' };
    }

    if (!complete) return { status: 'PENDING_TRUSTED_DECRYPTION' };

    if (envelopeCount === 0) {
      // An empty transport response does not prove completeness: production
      // event production/envelope delivery may be unavailable. Keep the UI
      // pending until the backend can establish that the feed is complete.
      return { status: 'PENDING_TRUSTED_DECRYPTION' };
    }

    return { status: 'READY', entries };
  }
}
