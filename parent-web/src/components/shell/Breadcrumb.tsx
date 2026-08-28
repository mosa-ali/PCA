import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';

/**
 * Route segment -> i18n key. Every static segment registered in App.tsx is
 * listed here, so a breadcrumb label is a real translated string in every
 * locale instead of the URL word it was previously built from (the old
 * `seg.replace(/-/g,' ').replace(/\b\w/g, upper)` produced "Trusted Browser"
 * for an Arabic parent too -- English on every breadcrumb of every route).
 *
 * Keys are reused from the existing `nav.*` / `subscription.*` / `rbac.*`
 * namespaces rather than duplicated, so a nav label and its breadcrumb can
 * never drift apart.
 */
const SEGMENT_LABEL_KEYS: Readonly<Record<string, string>> = {
  dashboard: 'nav.dashboard',
  children: 'nav.children',
  overview: 'nav.childrenOverview',
  'screen-time': 'nav.screenTime',
  apps: 'nav.appsGames',
  'web-protection': 'nav.webProtection',
  youtube: 'nav.youtube',
  location: 'nav.location',
  'eye-protection': 'nav.eyeProtection',
  prayer: 'nav.prayer',
  'wellbeing-messages': 'nav.wellbeingMessages',
  activity: 'nav.activityTimeline',
  requests: 'nav.requests',
  family: 'nav.family',
  members: 'nav.usersMembers',
  roles: 'nav.rolesPermissions',
  devices: 'nav.devices',
  privacy: 'nav.privacyData',
  retention: 'nav.retention',
  export: 'nav.export',
  delete: 'nav.deleteNow',
  transparency: 'nav.transparency',
  permissions: 'nav.permissionsPolicy',
  security: 'nav.security',
  status: 'nav.protectionStatus',
  'trusted-browser': 'nav.trustedBrowser',
  recovery: 'nav.recovery',
  audit: 'nav.audit',
  notifications: 'nav.notifications',
  subscription: 'nav.subscription',
  'increase-devices': 'subscription.increaseDevices.title',
  'increase-parent-members': 'subscription.increaseMembers.title',
  invoices: 'subscription.invoices.title',
  'checkout-return': 'subscription.checkoutReturn.title',
  settings: 'nav.settings',
  // Deliberately its own short key rather than `rbac.deniedTitle`: the
  // breadcrumb sits directly above the page's own `role="alert"` heading, and
  // reusing that heading's wording would announce the same sentence twice.
  'not-permitted': 'breadcrumb.notPermitted',
};

export function Breadcrumb() {
  const { t } = useTranslation();
  const location = useLocation();
  const segments = location.pathname.split('/').filter(Boolean);

  return (
    <nav className="breadcrumb" aria-label={t('shell.breadcrumbNav')}>
      <ol style={{ display: 'flex', gap: '0.4rem', listStyle: 'none', padding: 0, margin: 0, flexWrap: 'wrap' }}>
        <li>
          <Link to="/dashboard">{t('shell.breadcrumbHome')}</Link>
        </li>
        {segments.map((seg, i) => {
          const path = '/' + segments.slice(0, i + 1).join('/');
          const isLast = i === segments.length - 1;
          const labelKey = SEGMENT_LABEL_KEYS[seg];
          // Dynamic segments (a childId, an invoiceId) have no translation and
          // must not be word-cased into fake English. They are shown verbatim
          // inside a <bdi> so an opaque id can never reorder the surrounding
          // RTL breadcrumb trail.
          const label = labelKey ? <>{t(labelKey)}</> : <bdi className="iso">{seg}</bdi>;
          return (
            <li key={path} aria-current={isLast ? 'page' : undefined}>
              <span aria-hidden="true"> / </span>
              {isLast ? <span>{label}</span> : <Link to={path}>{label}</Link>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
