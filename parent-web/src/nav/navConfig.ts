export interface NavItem {
  path: string;
  labelKey: string;
}

export interface NavSection {
  titleKey?: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    items: [{ path: '/dashboard', labelKey: 'nav.dashboard' }],
  },
  {
    titleKey: 'nav.children',
    items: [
      { path: '/children', labelKey: 'nav.childrenOverview' },
    ],
  },
  {
    items: [
      { path: '/requests', labelKey: 'nav.requests' },
    ],
  },
  {
    titleKey: 'nav.family',
    items: [
      { path: '/family/members', labelKey: 'nav.usersMembers' },
      { path: '/family/roles', labelKey: 'nav.rolesPermissions' },
      { path: '/family/devices', labelKey: 'nav.devices' },
    ],
  },
  {
    titleKey: 'nav.privacyData',
    items: [
      { path: '/privacy/retention', labelKey: 'nav.retention' },
      { path: '/privacy/export', labelKey: 'nav.export' },
      { path: '/privacy/delete', labelKey: 'nav.deleteNow' },
      // PCA-FR-096: "What parents can see" reachable from panel navigation
      // (PCA-FR-121 is the normative page itself). ICR-PCA-FR-096-ROUTE
      // filed for the matching App.tsx <Route path="privacy/transparency">
      // registration (App.tsx is coordinator-owned).
      { path: '/privacy/transparency', labelKey: 'nav.transparency' },
    ],
  },
  {
    titleKey: 'nav.security',
    items: [
      { path: '/security/status', labelKey: 'nav.protectionStatus' },
      { path: '/security/recovery', labelKey: 'nav.recovery' },
      { path: '/security/audit', labelKey: 'nav.audit' },
    ],
  },
  {
    items: [
      { path: '/notifications', labelKey: 'nav.notifications' },
      { path: '/subscription', labelKey: 'nav.subscription' },
      { path: '/settings', labelKey: 'nav.settings' },
    ],
  },
];

export const CHILD_SUB_NAV: NavItem[] = [
  { path: 'overview', labelKey: 'nav.childrenOverview' },
  { path: 'screen-time', labelKey: 'nav.screenTime' },
  { path: 'apps', labelKey: 'nav.appsGames' },
  { path: 'web-protection', labelKey: 'nav.webProtection' },
  { path: 'youtube', labelKey: 'nav.youtube' },
  { path: 'location', labelKey: 'nav.location' },
  { path: 'eye-protection', labelKey: 'nav.eyeProtection' },
  { path: 'prayer', labelKey: 'nav.prayer' },
  { path: 'wellbeing-messages', labelKey: 'nav.wellbeingMessages' },
  // PCA-FR-092: consolidated per-child activity timeline. ICR-PCA-FR-092-ROUTE
  // filed for the matching App.tsx nested <Route path="activity"> under
  // children/:childId (App.tsx is coordinator-owned).
  { path: 'activity', labelKey: 'nav.activityTimeline' },
];
