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
import type { TrustedBrowserProvider } from '../../domain/trustedBrowser';
import type { ProtectionAlertDeliveryClient, ProtectionAlertFeedResult } from '../interfaces';
import type { ParentProtectionAlert, ParentProtectionAlertTrigger } from '../../pages/security/ProtectionAlertPanel';
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

function isOpaqueProtectionAlertEnvelope(value: unknown): value is OpaqueProtectionAlertEnvelope {
  return (
    isRecord(value) &&
    typeof value.alertId === 'string' &&
    (typeof value.deviceId === 'string' || value.deviceId === null) &&
    typeof value.trigger === 'string' &&
    KNOWN_TRIGGERS.includes(value.trigger as ParentProtectionAlertTrigger) &&
    typeof value.keyEpoch === 'number' &&
    typeof value.generatedAtUtc === 'string' &&
    typeof value.encryptedPayloadB64 === 'string' &&
    typeof value.nonceB64 === 'string'
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
    const snapshot = await this.trustedBrowser.getSnapshot();
    if (snapshot.state !== 'TRUSTED' || !snapshot.actorDeviceSessionToken) {
      return { status: 'PENDING_TRUSTED_DECRYPTION' };
    }

    const familyId = await cookieSessionFamilyId(this.apiBaseUrl);
    if (!familyId) return { status: 'PENDING_TRUSTED_DECRYPTION' };

    let envelopes: OpaqueProtectionAlertEnvelope[];
    try {
      const response = await fetch(this.url(`/api/parent/families/${encodeURIComponent(familyId)}/protection-alerts`), {
        credentials: 'include',
        headers: { Accept: 'application/json', Authorization: `Bearer ${snapshot.actorDeviceSessionToken}` },
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
