// Real, HTTP-backed ProtectionAlertDeliveryClient. Genuine networking code,
// not a stub: fetches this family's protection-alert envelopes from
// backend/src/http/routes/protectionAlertRoutes.ts using the SAME
// actor-device-session-token binding as RealFamilyAuditDeliveryClient (see
// that file's own doc comment for the full ceremony rationale). Unlike the
// audit-trail feed, `trigger`/`deviceId`/`generatedAtUtc` are
// already-decoded routing metadata on the wire (a closed event-category
// vocabulary, never readable family-data -- see
// backend/src/alerts/types.ts's own doc comment), so no decryption
// boundary is threaded through here; the envelope's
// `encryptedPayloadB64`/`nonceB64` payload is validated for shape (proving
// this stays a real opaque-envelope fetch, not a fabricated list) but is
// deliberately never read or surfaced past this file.
import type { ProtectionAlertDeliveryClient, ProtectionAlertFeedResult } from '../interfaces';
import type { ParentProtectionAlert, ParentProtectionAlertTrigger } from '../../pages/security/ProtectionAlertPanel';
import type { TrustedBrowserProvider } from '../../domain/trustedBrowser';
import { cookieSessionFamilyId } from './realBillingClient';

const KNOWN_TRIGGERS: readonly ParentProtectionAlertTrigger[] = [
  'DISABLE_OR_REMOVAL_REQUESTED',
  'REPEATED_INVALID_PIN',
  'AUTHORITY_CHANGE',
  'CRITICAL_PERMISSION_OR_VPN_LOST',
  'UNEXPECTED_OFFLINE',
  'TIME_TAMPERING',
  'PROTECTION_DEGRADED',
  'REINSTALLATION',
  'INVITATION_REDEEMED',
  'UNENROLLMENT',
];

// Mirror backend/src/alerts/policy.ts's persisted envelope contract. The
// payload stays opaque here; only its canonical wire encoding and byte bound
// are checked before the feed result reaches UI code.
const MAX_ENCRYPTED_PAYLOAD_BYTES = 16 * 1024;
const MAX_NONCE_BYTES = 64;
const STANDARD_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

interface OpaqueProtectionAlertEnvelope {
  alertId: string;
  deviceId: string | null;
  trigger: ParentProtectionAlertTrigger;
  keyEpoch: number;
  generatedAtUtc: string;
  encryptedPayloadB64: string;
  nonceB64: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCanonicalBase64Within(value: unknown, maximumBytes: number): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > Math.ceil(maximumBytes / 3) * 4 || !STANDARD_BASE64.test(value)) {
    return false;
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const decodedBytes = value.length / 4 * 3 - padding;
  if (decodedBytes < 1 || decodedBytes > maximumBytes) return false;
  if (padding === 2 && (BASE64_ALPHABET.indexOf(value[value.length - 3]!) & 0x0f) !== 0) return false;
  if (padding === 1 && (BASE64_ALPHABET.indexOf(value[value.length - 2]!) & 0x03) !== 0) return false;
  return true;
}

function isOpaqueProtectionAlertEnvelope(value: unknown): value is OpaqueProtectionAlertEnvelope {
  return (
    isRecord(value) &&
    typeof value.alertId === 'string' &&
    (typeof value.deviceId === 'string' || value.deviceId === null) &&
    typeof value.trigger === 'string' &&
    KNOWN_TRIGGERS.includes(value.trigger as ParentProtectionAlertTrigger) &&
    typeof value.keyEpoch === 'number' &&
    typeof value.generatedAtUtc === 'string' &&
    isCanonicalBase64Within(value.encryptedPayloadB64, MAX_ENCRYPTED_PAYLOAD_BYTES) &&
    isCanonicalBase64Within(value.nonceB64, MAX_NONCE_BYTES)
  );
}

function toParentProtectionAlert(envelope: OpaqueProtectionAlertEnvelope): ParentProtectionAlert {
  return {
    alertId: envelope.alertId,
    deviceId: envelope.deviceId,
    trigger: envelope.trigger,
    generatedAtUtc: envelope.generatedAtUtc,
  };
}

export class RealProtectionAlertDeliveryClient implements ProtectionAlertDeliveryClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly trustedBrowser: TrustedBrowserProvider,
  ) {}

  private url(path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}${path}`;
  }

  async list(): Promise<ProtectionAlertFeedResult> {
    const familyId = await cookieSessionFamilyId(this.apiBaseUrl);
    if (!familyId) return { status: 'PENDING_TRUSTED_DECRYPTION' };

    let actorDeviceSessionToken: string | null;
    try {
      const snapshot = await this.trustedBrowser.getSnapshot();
      actorDeviceSessionToken = snapshot.state === 'TRUSTED' &&
        typeof snapshot.actorDeviceSessionToken === 'string' && snapshot.actorDeviceSessionToken.length > 0
        ? snapshot.actorDeviceSessionToken
        : null;
    } catch {
      return { status: 'PENDING_TRUSTED_DECRYPTION' };
    }
    if (!actorDeviceSessionToken) return { status: 'PENDING_TRUSTED_DECRYPTION' };

    let envelopes: OpaqueProtectionAlertEnvelope[];
    try {
      const response = await fetch(this.url(`/api/parent/families/${encodeURIComponent(familyId)}/protection-alerts`), {
        credentials: 'include',
        headers: { Accept: 'application/json', Authorization: `Bearer ${actorDeviceSessionToken}` },
      });
      if (!response.ok) return { status: 'PENDING_TRUSTED_DECRYPTION' };
      const body: unknown = await response.json();
      if (!isRecord(body) || !Array.isArray(body.alerts) || !body.alerts.every(isOpaqueProtectionAlertEnvelope)) {
        return { status: 'PENDING_TRUSTED_DECRYPTION' };
      }
      envelopes = body.alerts;
    } catch {
      return { status: 'PENDING_TRUSTED_DECRYPTION' };
    }

    // A genuinely empty list is an honest READY/empty state -- never
    // conflated with "can't fetch/authenticate yet".
    return { status: 'READY', alerts: envelopes.map(toParentProtectionAlert) };
  }
}
