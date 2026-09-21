export type GuideCategoryId =
  | 'gettingStarted'
  | 'dashboard'
  | 'children'
  | 'devices'
  | 'requests'
  | 'members'
  | 'roles'
  | 'protection'
  | 'safetyPrivacy'
  | 'notifications'
  | 'billing'
  | 'settings'
  | 'download'
  | 'troubleshooting';

export type GuideAvailability = 'available' | 'setup' | 'permission' | 'unavailable';

export interface GuideCategory {
  id: GuideCategoryId;
  titleKey: string;
}

export interface GuideTopic {
  id: string;
  category: GuideCategoryId;
  contentKey: string;
  availability: GuideAvailability;
  openPagePath?: string;
  routePatterns: readonly string[];
  relatedTopicIds: readonly string[];
  permissionAction?: string;
  /** Search aliases are deliberately kept beside the authoritative topic. */
  searchTerms: readonly string[];
}
