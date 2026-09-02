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
import type { ActivityTimelineCategory, ActivityTimelineEntry } from '../../domain/activityTimeline';
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

let nextUpdateAppRuleFailure: string | null = null;

/** Dev-only hook so AppsPage.tsx's error-surfacing path is exercisable without a real backend failure. */
export function __devFailNextUpdateAppRule(message: string): void {
  nextUpdateAppRuleFailure = message;
}

let nextUpdateEyeProtectionFailure: string | null = null;

/** Dev-only hook so EyeProtectionPage.tsx's error-surfacing path is exercisable without a real backend failure. */
export function __devFailNextUpdateEyeProtection(message: string): void {
  nextUpdateEyeProtectionFailure = message;
}

/**
 * PCA-FR-092: illustrative, in-memory, category-level activity entries --
 * NOT a claim about real event shapes/volume, only enough variety to
 * exercise the consolidated-timeline UI across every category in
 * ../../domain/activityTimeline.ts. Generated deterministically per
 * childId (not random) so a demo session's timeline is stable across
 * reloads.
 */
const DEV_TIMELINE_TEMPLATE: { category: ActivityTimelineCategory; minutesAgo: number; summary: string; detail: string | null }[] = [
  { category: 'APP_USAGE', minutesAgo: 12, summary: 'Used an Education app for 22 minutes', detail: null },
  { category: 'WEB_BROWSING', minutesAgo: 40, summary: 'Visited a site in the Reference category', detail: 'ALLOWED' },
  { category: 'CONTENT_BLOCK', minutesAgo: 55, summary: 'A site in the Adult category was blocked', detail: 'RULE_MATCH' },
  { category: 'BREAK_SESSION', minutesAgo: 70, summary: 'Took a 5-minute screen break after continuous use', detail: 'COMPLETED' },
  { category: 'EYE_PROTECTION', minutesAgo: 95, summary: 'An eye-rest reminder was shown', detail: null },
  { category: 'LOCATION', minutesAgo: 130, summary: 'Location updated to the Home trust zone', detail: null },
  { category: 'PRAYER_REMINDER', minutesAgo: 160, summary: 'Asr prayer reminder delivered', detail: 'DELIVERED' },
  { category: 'APP_USAGE', minutesAgo: 200, summary: 'Used a Social app for 15 minutes', detail: null },
  { category: 'WEB_BROWSING', minutesAgo: 260, summary: 'Visited a site in the Video Streaming category', detail: 'ALLOWED' },
  { category: 'CONTENT_BLOCK', minutesAgo: 300, summary: 'A site in the Gambling category was blocked', detail: 'RULE_MATCH' },
  { category: 'BREAK_SESSION', minutesAgo: 340, summary: 'Took a 10-minute screen break after continuous use', detail: 'COMPLETED' },
  { category: 'PRAYER_REMINDER', minutesAgo: 400, summary: 'Dhuhr prayer reminder delivered', detail: 'DELIVERED' },
];

function generateDevActivityTimeline(childId: string, now: Date): ActivityTimelineEntry[] {
  return DEV_TIMELINE_TEMPLATE.map((t, i) => ({
    entryId: `${childId}-timeline-${i}`,
    childId,
    category: t.category,
    timestampUtc: new Date(now.getTime() - t.minutesAgo * 60_000).toISOString(),
    summary: t.summary,
    detail: t.detail,
  }));
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
    if (nextUpdateAppRuleFailure) {
      const message = nextUpdateAppRuleFailure;
      nextUpdateAppRuleFailure = null;
      throw new Error(message);
    }
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

  async updateEyeProtection(childId: string, remindersEnabled: boolean): Promise<{ remindersEnabled: boolean }> {
    await delay();
    if (nextUpdateEyeProtectionFailure) {
      const message = nextUpdateEyeProtectionFailure;
      nextUpdateEyeProtectionFailure = null;
      throw new Error(message);
    }
    const current = requireFixture(DEV_EYE, childId, 'eye protection');
    DEV_EYE[childId] = { ...current, remindersEnabled };
    return { remindersEnabled };
  }

  async getPrayerSettings(childId: string): Promise<PrayerSettings> {
    await delay();
    return requireFixture(DEV_PRAYER, childId, 'prayer settings');
  }

  async getActivityTimeline(childId: string, limit = 100): Promise<ActivityTimelineEntry[]> {
    await delay();
    // Confirms the child is a known fixture (consistent 404-shaped failure
    // with every other getter above) before generating illustrative entries.
    requireFixture(DEV_SCREEN_TIME, childId, 'activity timeline');
    return generateDevActivityTimeline(childId, new Date()).slice(0, limit);
  }
}
