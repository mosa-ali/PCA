import type { ReactNode } from 'react';

export interface NavItem {
  path: string;
  labelKey: string;
  /**
   * Optional 18x18 glyph for the `.nav-link-icon` slot the stylesheet already
   * reserves. No icons ship in PPR-2; the slot exists so adding them later is
   * not a re-layout. Any chevron/arrow placed here must mirror under RTL.
   */
  icon?: ReactNode;
}

export interface NavSection {
  /** Required: every first-level group is one of the five consumer groups below. */
  titleKey: string;
  icon?: ReactNode;
  items: NavItem[];
}

/**
 * FIRST-LEVEL NAVIGATION -- five consumer groups, 19 entries.
 *
 * This replaces a flat six-section/18-entry list whose groups were named after
 * the system ("Privacy & Data", "Security") rather than after what a parent is
 * trying to do. NOTHING WAS REMOVED. Every route that was in the old config is
 * still in this one, and one route that was registered but reachable only by
 * typing its URL (`/wellbeing-messages`, App.tsx) is now reachable from the
 * nav for the first time:
 *
 *   old entry              -> new group          note
 *   ---------------------- -> ------------------ ------------------------------
 *   /dashboard             -> HOME
 *   /children              -> FAMILY             label "Overview" -> "Children"
 *   /requests              -> FAMILY             label pinned exactly "Requests"
 *   /family/members        -> FAMILY             label -> nav.familyMembers
 *   /family/roles          -> FAMILY             controlled: route + label kept
 *   /family/devices        -> FAMILY
 *   /security/status       -> PROTECTION
 *   /wellbeing-messages    -> PROTECTION         was in NO section at all
 *   /security/trusted-browser -> SAFETY&PRIVACY  label pinned "Trusted Browser"
 *   /security/recovery     -> SAFETY&PRIVACY     controlled: route kept
 *   /security/audit        -> SAFETY&PRIVACY     controlled: route kept,
 *                                                 label -> "Security Log"
 *   /privacy/retention     -> SAFETY&PRIVACY, inside the /privacy hub
 *   /privacy/export        -> SAFETY&PRIVACY, inside the /privacy hub
 *   /privacy/delete        -> SAFETY&PRIVACY, inside the /privacy hub
 *   /privacy/transparency  -> SAFETY&PRIVACY, inside the /privacy hub
 *   /privacy/permissions   -> SAFETY&PRIVACY, inside the /privacy hub
 *   /notifications         -> ACCOUNT
 *   /subscription          -> ACCOUNT
 *   /settings              -> ACCOUNT
 *
 * The five privacy routes are the only ones that moved off the first level.
 * They are NOT gone: each keeps its own route, its own RouteGuard, its own
 * breadcrumb and its own direct link, and all five are listed on the
 * /privacy hub page (pages/privacy/PrivacyHub.tsx). Retention, Export,
 * Delete Now, Audit and Roles & Permissions are controlled capabilities --
 * regrouping one is allowed, removing one is not.
 *
 * /protection/screen-time, /protection/apps-web and /protection/schedules are
 * new child-picker index pages: the per-child policy routes they lead to
 * already existed, but there was no family-level way in.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    titleKey: 'nav.groupHome',
    items: [{ path: '/dashboard', labelKey: 'nav.dashboard' }],
  },
  {
    titleKey: 'nav.groupFamily',
    items: [
      { path: '/children', labelKey: 'nav.children' },
      { path: '/family/devices', labelKey: 'nav.devices' },
      // Pinned accessible name: e2e/keyboard-accessibility.spec.ts and
      // e2e/responsive.spec.ts both locate this link by the exact text
      // "Requests".
      { path: '/requests', labelKey: 'nav.requests' },
      { path: '/family/members', labelKey: 'nav.familyMembers' },
      { path: '/family/roles', labelKey: 'nav.rolesPermissions' },
    ],
  },
  {
    titleKey: 'nav.groupProtection',
    items: [
      { path: '/security/status', labelKey: 'nav.protectionStatus' },
      { path: '/protection/screen-time', labelKey: 'nav.screenTime' },
      { path: '/protection/apps-web', labelKey: 'nav.appsWeb' },
      { path: '/protection/schedules', labelKey: 'nav.schedules' },
      // Recovered orphan: the route has always existed (App.tsx) but appeared
      // in no nav section, so it was reachable only by typing the URL.
      { path: '/wellbeing-messages', labelKey: 'nav.wellbeingMessages' },
    ],
  },
  {
    titleKey: 'nav.groupSafetyPrivacy',
    items: [
      { path: '/safety/alerts', labelKey: 'nav.alerts' },
      // The hub. PCA-FR-096/121 (What Parents Can See) and PCA-NFR-061 (App
      // Permissions) are reached from it, together with retention, export and
      // delete -- all five keep their own routes and RouteGuards.
      { path: '/privacy', labelKey: 'nav.dataPrivacy' },
      { path: '/security/recovery', labelKey: 'nav.recovery' },
      { path: '/security/audit', labelKey: 'nav.securityLog' },
      // Pinned accessible name: tests/component/SidebarTrustedBrowserLink.test.tsx
      // asserts a link named exactly "Trusted Browser" pointing here.
      { path: '/security/trusted-browser', labelKey: 'nav.trustedBrowser' },
    ],
  },
  {
    titleKey: 'nav.groupAccount',
    items: [
      // Also reachable from the header bell. The nav entry is deliberately
      // kept: a header icon is a shortcut, not a replacement for a nav row.
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
