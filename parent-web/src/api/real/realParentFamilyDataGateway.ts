// Real (non-fixture) ParentFamilyDataGateway. Every method is gated by
// requireTrustedAndCryptoReady (trust state, then the crypto suite's
// human-security-review gate) before it will ever read
// ../../security/localFamilyDataStore.ts -- which itself is never populated
// with real data by anything in this repository slice today (the only
// decryptor shipped, NotReadyDecryptor, always throws). So in practice
// every method here rejects with EndpointNotTrustedError or
// CryptoReviewRequiredError -- that is the correct, honest behavior, not a
// bug. Once a real EnvelopeDecryptor is approved and something actually
// calls localFamilyDataStore.put(...), the read paths below already know
// how to serve that data (including honestly labeling offline/stale reads
// via CapabilityState, e.g. OFFLINE/EPOCH_STALE, which the domain type
// already models -- see ../../domain/types.ts).
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
type ScreenTimePatch = Partial<Pick<ScreenTimeStatus, 'continuousUseLimitMinutes' | 'breakDurationMinutes'>>;
import type { ParentFamilyDataGateway } from '../interfaces';
import type { TrustedBrowserProvider } from '../../domain/trustedBrowser';
import { localFamilyDataStore, type LocalFamilyDataStore } from '../../security/localFamilyDataStore';
import { requireTrustedAndCryptoReady } from './familyDataGate';

export class RealParentFamilyDataGateway implements ParentFamilyDataGateway {
  constructor(
    private readonly trustedBrowser: TrustedBrowserProvider,
    private readonly store: LocalFamilyDataStore = localFamilyDataStore,
  ) {}

  private async readOrExplainUnavailable<T>(operation: string, storeKey: string): Promise<T> {
    await requireTrustedAndCryptoReady(this.trustedBrowser, operation);
    // Reached only once trust + crypto-review checks both pass (never true
    // in this repository slice). Serves whatever the (currently always
    // empty) local store holds, or throws if this specific record was never
    // decrypted, rather than fabricating a value.
    const record = this.store.get<T>(storeKey);
    if (!record) {
      throw new Error(`${operation}: endpoint is trusted and crypto is ready, but no decrypted record is cached yet for "${storeKey}".`);
    }
    return record.data;
  }

  getDashboard(): Promise<DashboardSnapshot> {
    return this.readOrExplainUnavailable('ParentFamilyDataGateway.getDashboard', 'dashboard');
  }
  getScreenTime(childId: string): Promise<ScreenTimeStatus> {
    return this.readOrExplainUnavailable('ParentFamilyDataGateway.getScreenTime', `screenTime:${childId}`);
  }
  async updateScreenTime(_childId: string, _patch: ScreenTimePatch): Promise<{ auditEventId: string }> {
    await requireTrustedAndCryptoReady(this.trustedBrowser, 'ParentFamilyDataGateway.updateScreenTime');
    throw new Error('ParentFamilyDataGateway.updateScreenTime: mutation path not implemented yet even post-crypto-approval.');
  }
  getAppRules(childId: string): Promise<AppRule[]> {
    return this.readOrExplainUnavailable('ParentFamilyDataGateway.getAppRules', `appRules:${childId}`);
  }
  async updateAppRule(_childId: string, _appId: string, _patch: Partial<AppRule>): Promise<{ auditEventId: string }> {
    await requireTrustedAndCryptoReady(this.trustedBrowser, 'ParentFamilyDataGateway.updateAppRule');
    throw new Error('ParentFamilyDataGateway.updateAppRule: mutation path not implemented yet even post-crypto-approval.');
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
  getPrayerSettings(childId: string): Promise<PrayerSettings> {
    return this.readOrExplainUnavailable('ParentFamilyDataGateway.getPrayerSettings', `prayer:${childId}`);
  }
}
