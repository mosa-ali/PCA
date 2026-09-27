// Real (non-fixture) ParentFamilyDataGateway. Every family-content method is gated by
// requireFamilyCryptoReady (the crypto suite's
// human-security-review gate) before it will ever read
// ../../security/localFamilyDataStore.ts -- which itself is never populated
// with real data by anything in this repository slice today (the only
// decryptor shipped, NotReadyDecryptor, always throws). So in practice
// every family-content method here rejects with CryptoReviewRequiredError -- that is the correct, honest behavior, not a
// bug. Once a real EnvelopeDecryptor is approved and something actually
// calls localFamilyDataStore.put(...), the read paths below already know
// how to serve that data (including honestly labeling offline/stale reads
// via CapabilityState, e.g. OFFLINE/EPOCH_STALE, which the domain type
// already models -- see ../../domain/types.ts).
//
// updateScreenTime/updateAppRule are genuinely real writes (not stubs):
// they construct a schedulePolicyAuthoring.ts plaintext definition and
// submit it via VerifiedFamilySchedulePolicyPublisher, which encrypts
// (currently always CRYPTO_REVIEW_REQUIRED -- see UnavailableSchedulePolicyAuthoring)
// and, once that gate clears, relays through the real
// backend/src/http/routes/childPolicyRoutes.ts -> OutboundRelayService
// path. This resolves to PENDING only -- never APPLIED -- matching the
// PENDING/DELIVERED/APPLIED discipline documented in
// docs/product-completion/PCA_FAMILY_AUTHORITY_COMPLETION_ARCHITECTURE.md.
import type {
  AppRule,
  DashboardSnapshot,
  EyeProtectionStatus,
  LocationStatus,
  PrayerSettings,
  ScreenTimeStatus,
  WebProtectionStatus,
  YouTubeStatus,
} from '../../domain/types';
import type { ActivityTimelineEntry } from '../../domain/activityTimeline';
type ScreenTimePatch = Partial<Pick<ScreenTimeStatus, 'continuousUseLimitMinutes' | 'breakDurationMinutes'>>;
import type { DeviceStatusClient, ParentFamilyDataGateway } from '../interfaces';
import { localFamilyDataStore, type LocalFamilyDataStore } from '../../security/localFamilyDataStore';
import { requireFamilyCryptoReady } from './familyDataGate';
import { cookieSessionFamilyId } from './realBillingClient';
import { RealDeviceStatusClient } from './realDeviceStatusClient';
import {
  VerifiedFamilySchedulePolicyPublisher,
  type SchedulePolicyAuthoring,
  type SchedulePolicyPlaintextDefinition,
  type SchedulePolicyTransport,
} from '../schedulePolicyAuthoring';

/**
 * The ONE place this app turns a childId into the device id a policy
 * envelope / sync lookup is addressed to.
 *
 * This used to be `\`device-${childId}\``, a fabricated id: backend
 * migrations/0001_mysql_baseline.sql declares `device_id CHAR(36)` (a
 * UUID), so a 'device-' prefix plus a 36-character child id is 43
 * characters and could never match a real device row -- every real-mode
 * call built on it was addressed to a device that cannot exist. The real
 * value is DeviceProtectionStatus.deviceId (../../domain/types.ts), served
 * by DeviceStatusClient, so it is read from there.
 *
 * When no device id resolves, this throws. It must never fall back to a
 * synthesized or empty id: backend/src/http/routes/childPolicyRoutes.ts
 * rejects a spoofed recipient by design, and a fabricated id would turn
 * that honest server rejection into a silent client-side lie.
 */
export async function resolveChildDeviceId(deviceStatus: DeviceStatusClient, childId: string): Promise<string> {
  const devices = await deviceStatus.listDeviceStatuses(childId);
  const deviceId = devices.find((device) => device.childId === childId && device.deviceId.length > 0)?.deviceId;
  if (!deviceId) {
    throw new Error(
      `resolveChildDeviceId: no enrolled device is known for child "${childId}", so there is no real recipient device id to address. Refusing to fabricate one.`,
    );
  }
  return deviceId;
}

const CSRF_COOKIE_NAME = 'pca_family_csrf';
const CSRF_HEADER_NAME = 'X-PCA-CSRF-Token';

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const entry = document.cookie.split('; ').find((value) => value.startsWith(`${CSRF_COOKIE_NAME}=`));
  return entry ? decodeURIComponent(entry.slice(CSRF_COOKIE_NAME.length + 1)) : null;
}

export class RealParentFamilyDataGateway implements ParentFamilyDataGateway {
  constructor(
    private readonly schedulePolicyAuthoring: SchedulePolicyAuthoring,
    private readonly schedulePolicyTransport: SchedulePolicyTransport,
    private readonly apiBaseUrl: string,
    private readonly store: LocalFamilyDataStore = localFamilyDataStore,
    /**
     * Source of the REAL recipient device id (see resolveChildDeviceId
     * above). ../client.ts passes the same instance it exposes as
     * `clients.deviceStatus`, so "which device is this child's" can never
     * mean one thing to this gateway and another to the UI.
     */
    private readonly deviceStatus: DeviceStatusClient = new RealDeviceStatusClient(store),
  ) {}

  private async readOrExplainUnavailable<T>(operation: string, storeKey: string): Promise<T> {
    await requireFamilyCryptoReady(operation);
    // Reached only once crypto review passes. Serves whatever the (currently always
    // empty) local store holds, or throws if this specific record was never
    // decrypted, rather than fabricating a value.
    const record = this.store.get<T>(storeKey);
    if (!record) {
      throw new Error(`${operation}: crypto is ready, but no decrypted record is cached yet for "${storeKey}".`);
    }
    return record.data;
  }

  getDashboard(): Promise<DashboardSnapshot> {
    return this.readOrExplainUnavailable('ParentFamilyDataGateway.getDashboard', 'dashboard');
  }
  getScreenTime(childId: string): Promise<ScreenTimeStatus> {
    return this.readOrExplainUnavailable('ParentFamilyDataGateway.getScreenTime', `screenTime:${childId}`);
  }
  async updateScreenTime(childId: string, patch: ScreenTimePatch): Promise<{ auditEventId: string }> {
    await requireFamilyCryptoReady('ParentFamilyDataGateway.updateScreenTime');
    if (patch.continuousUseLimitMinutes === undefined || patch.breakDurationMinutes === undefined) {
      throw new Error('ParentFamilyDataGateway.updateScreenTime: both continuousUseLimitMinutes and breakDurationMinutes are required -- this is a full-policy replacement, not a partial patch (see schedulePolicyAuthoring.ts).');
    }
    const result = await this.publishSchedulePolicy(childId, {
      kind: 'CONTINUOUS_USE_AND_BREAK',
      childProfileId: childId,
      continuousUseLimitMinutes: patch.continuousUseLimitMinutes,
      breakDurationMinutes: patch.breakDurationMinutes,
    });
    return { auditEventId: result.messageId };
  }
  getAppRules(childId: string): Promise<AppRule[]> {
    return this.readOrExplainUnavailable('ParentFamilyDataGateway.getAppRules', `appRules:${childId}`);
  }
  async updateAppRule(childId: string, appId: string, patch: Partial<AppRule>): Promise<{ auditEventId: string }> {
    await requireFamilyCryptoReady('ParentFamilyDataGateway.updateAppRule');
    if (patch.allowed === undefined) {
      throw new Error('ParentFamilyDataGateway.updateAppRule: allowed is required.');
    }
    const result = await this.publishSchedulePolicy(childId, {
      kind: 'APP_RULE',
      childProfileId: childId,
      appRule: { appId, allowed: patch.allowed, dailyLimitMinutes: patch.dailyLimitMinutes ?? null },
    });
    return { auditEventId: result.messageId };
  }

  private async publishSchedulePolicy(
    childId: string,
    definition: SchedulePolicyPlaintextDefinition,
  ): Promise<{ messageId: string }> {
    const familyId = await cookieSessionFamilyId(this.apiBaseUrl);
    if (!familyId) throw new Error('ParentFamilyDataGateway: no authenticated family session available.');
    const recipientDeviceId = await resolveChildDeviceId(this.deviceStatus, childId);
    const publisher = new VerifiedFamilySchedulePolicyPublisher(this.schedulePolicyAuthoring, this.schedulePolicyTransport);
    const result = await publisher.publish(familyId, recipientDeviceId, definition);
    return { messageId: result.messageId };
  }
  getWebProtection(childId: string): Promise<WebProtectionStatus> {
    return this.readOrExplainUnavailable('ParentFamilyDataGateway.getWebProtection', `webProtection:${childId}`);
  }
  getYouTubeStatus(childId: string): Promise<YouTubeStatus> {
    return this.readOrExplainUnavailable('ParentFamilyDataGateway.getYouTubeStatus', `youtube:${childId}`);
  }
  getLocationStatus(childId: string): Promise<LocationStatus> {
    return this.readOrExplainUnavailable('ParentFamilyDataGateway.getLocationStatus', `location:${childId}`);
  }
  getEyeProtectionStatus(childId: string): Promise<EyeProtectionStatus> {
    return this.readOrExplainUnavailable('ParentFamilyDataGateway.getEyeProtectionStatus', `eyeProtection:${childId}`);
  }

  /**
   * Genuinely real write (not a stub), like updateScreenTime/updateAppRule
   * above -- but unlike them, this does NOT go through
   * schedulePolicyAuthoring.ts's encrypted-envelope relay: the reminders-
   * enabled preference is a plain, non-E2EE boolean (see backend
   * migrations/0032_eye_protection_settings.sql's own header for why that
   * is the reviewed posture for this specific field), so this calls the
   * real backend/src/http/routes/eyeProtectionRoutes.ts endpoint directly.
   * The endpoint derives authority from the active Parent family session,
   * checks Administrator membership, and enforces the double-submit CSRF
   * header; no paired-browser token is needed for this ordinary setting.
   */
  async updateEyeProtection(childId: string, remindersEnabled: boolean): Promise<{ remindersEnabled: boolean }> {
    const familyId = await cookieSessionFamilyId(this.apiBaseUrl);
    if (!familyId) throw new Error('ParentFamilyDataGateway.updateEyeProtection: no authenticated family session available.');

    const csrf = readCsrfCookie();
    if (!csrf) throw new Error('ParentFamilyDataGateway.updateEyeProtection: CSRF token unavailable.');
    const url = `${this.apiBaseUrl.replace(/\/+$/, '')}/api/parent/families/${encodeURIComponent(familyId)}/children/${encodeURIComponent(childId)}/eye-protection`;
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        [CSRF_HEADER_NAME]: csrf,
      },
      body: JSON.stringify({ remindersEnabled }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const code = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null;
      throw new Error(`ParentFamilyDataGateway.updateEyeProtection: request failed (${response.status}${code ? `: ${code}` : ''}).`);
    }
    const body = (await response.json()) as { eyeProtection?: { remindersEnabled?: unknown } };
    return { remindersEnabled: typeof body.eyeProtection?.remindersEnabled === 'boolean' ? body.eyeProtection.remindersEnabled : remindersEnabled };
  }
  getPrayerSettings(childId: string): Promise<PrayerSettings> {
    return this.readOrExplainUnavailable('ParentFamilyDataGateway.getPrayerSettings', `prayer:${childId}`);
  }
  async getActivityTimeline(childId: string, limit = 100): Promise<ActivityTimelineEntry[]> {
    const entries = await this.readOrExplainUnavailable<ActivityTimelineEntry[]>('ParentFamilyDataGateway.getActivityTimeline', `activityTimeline:${childId}`);
    return entries.slice(0, limit);
  }
}
