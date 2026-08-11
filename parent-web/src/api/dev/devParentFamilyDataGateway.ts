import type { ParentFamilyDataGateway } from '../interfaces';
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
import {
  DEV_APP_RULES,
  DEV_CHILDREN,
  DEV_EYE,
  DEV_LOCATION,
  DEV_PRAYER,
  DEV_SCREEN_TIME,
  DEV_WEB_PROTECTION,
  DEV_YOUTUBE,
} from './fixtures';

const delay = (ms = 150) => new Promise((r) => setTimeout(r, ms));

function requireFixture<T>(map: Record<string, T>, childId: string, what: string): T {
  const v = map[childId];
  if (!v) throw new Error(`No DEVELOPMENT_ONLY fixture for ${what} / childId=${childId}`);
  return v;
}

/** DEVELOPMENT_ONLY fixture implementation of ParentFamilyDataGateway. */
export class DevParentFamilyDataGateway implements ParentFamilyDataGateway {
  async getDashboard(): Promise<DashboardSnapshot> {
    await delay();
    return {
      children: DEV_CHILDREN,
      familyEpoch: { trustSetEpoch: 4, keyEpoch: 4, lastAcknowledgedPolicyRevision: 14 },
      generatedAtUtc: new Date().toISOString(),
      isFixtureData: true,
    };
  }

  async getScreenTime(childId: string): Promise<ScreenTimeStatus> {
    await delay();
    return requireFixture(DEV_SCREEN_TIME, childId, 'screen time');
  }

  async updateScreenTime(
    childId: string,
    patch: Partial<Pick<ScreenTimeStatus, 'continuousUseLimitMinutes' | 'breakDurationMinutes'>>,
  ): Promise<{ auditEventId: string }> {
    await delay();
    const current = requireFixture(DEV_SCREEN_TIME, childId, 'screen time');
    DEV_SCREEN_TIME[childId] = { ...current, ...patch };
    return { auditEventId: `audit-screen-time-${Date.now()}` };
  }

  async getAppRules(childId: string): Promise<AppRule[]> {
    await delay();
    return requireFixture(DEV_APP_RULES, childId, 'app rules');
  }

  async updateAppRule(childId: string, appId: string, patch: Partial<AppRule>): Promise<{ auditEventId: string }> {
    await delay();
    const rules = requireFixture(DEV_APP_RULES, childId, 'app rules');
    DEV_APP_RULES[childId] = rules.map((r) => (r.appId === appId ? { ...r, ...patch } : r));
    return { auditEventId: `audit-app-rule-${Date.now()}` };
  }

  async getWebProtection(childId: string): Promise<WebProtectionStatus> {
    await delay();
    return requireFixture(DEV_WEB_PROTECTION, childId, 'web protection');
  }

  async getYouTubeStatus(childId: string): Promise<YouTubeStatus> {
    await delay();
    return requireFixture(DEV_YOUTUBE, childId, 'YouTube status');
  }

  async getLocationStatus(childId: string): Promise<LocationStatus> {
    await delay();
    return requireFixture(DEV_LOCATION, childId, 'location status');
  }

  async getEyeProtectionStatus(childId: string): Promise<EyeProtectionStatus> {
    await delay();
    return requireFixture(DEV_EYE, childId, 'eye protection');
  }

  async getPrayerSettings(childId: string): Promise<PrayerSettings> {
    await delay();
    return requireFixture(DEV_PRAYER, childId, 'prayer settings');
  }
}
