import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useCurrentRole } from '../../state/AuthContext';
import { evaluatePermission } from '../../domain/roles';
import type { FamilyAction } from '../../domain/roles';

/**
 * DATA & PRIVACY HUB.
 *
 * This page exists so five system-named sidebar rows can become one
 * consumer-legible one WITHOUT any capability being removed. Retention,
 * Export, Delete Now, What Parents Can See and App Permissions are all
 * controlled capabilities: every one keeps its own route, its own RouteGuard
 * in App.tsx, its own breadcrumb and its own direct link. Nothing here is a
 * replacement for those pages -- it is a way in to them.
 *
 * The three RBAC-gated entries reflect their gate here rather than letting a
 * parent click through to a "Not permitted" page. That is presentation only:
 * the real boundary is the RouteGuard on the route plus the gateway's own
 * re-check, exactly as before. This page hides nothing -- a gated capability
 * is still listed, still described, and still named; only its link is
 * withheld, so the parent can see the capability exists and who can use it.
 */
interface PrivacyHubEntry {
  path: string;
  labelKey: string;
  descriptionKey: string;
  /** The RouteGuard action protecting this route in App.tsx, when there is one. */
  action?: FamilyAction;
}

const ENTRIES: PrivacyHubEntry[] = [
  { path: '/privacy/retention', labelKey: 'nav.retention', descriptionKey: 'privacyHub.retentionDesc', action: 'CHANGE_RETENTION' },
  { path: '/privacy/export', labelKey: 'nav.export', descriptionKey: 'privacyHub.exportDesc', action: 'EXPORT_DATA' },
  { path: '/privacy/delete', labelKey: 'nav.deleteNow', descriptionKey: 'privacyHub.deleteDesc', action: 'DELETE_HISTORY' },
  // PCA-FR-096/121.
  { path: '/privacy/transparency', labelKey: 'nav.transparency', descriptionKey: 'privacyHub.transparencyDesc' },
  // PCA-NFR-061.
  { path: '/privacy/permissions', labelKey: 'nav.permissionsPolicy', descriptionKey: 'privacyHub.permissionsDesc' },
];

export default function PrivacyHub() {
  const { t } = useTranslation();
  const role = useCurrentRole();

  return (
    <section aria-labelledby="privacy-hub-title">
      <h1 id="privacy-hub-title">{t('privacyHub.title')}</h1>
      <p>{t('privacyHub.intro')}</p>
      <div className="card-grid">
        {ENTRIES.map((entry) => {
          const permission = entry.action ? evaluatePermission(role, entry.action) : null;
          const allowed = permission === null || permission.allowed;
          const label = t(entry.labelKey);
          return (
            <article className={allowed ? 'card card-interactive' : 'card'} key={entry.path}>
              <h2 className="card-title">{allowed ? <Link to={entry.path}>{label}</Link> : label}</h2>
              <p className="card-body">{t(entry.descriptionKey)}</p>
              {!allowed && (
                <p className="permission-disabled">
                  <span className="permission-disabled-badge">{t('rbac.denied')}</span>
                  {/* The localized reason, never `permission.reason`: that field is
                      the English developer diagnostic (see domain/roles.ts). Omitted
                      rather than defaulted, so the badge's sentence is never simply
                      repeated back underneath itself. */}
                  {permission?.reasonKey ? <> {t(permission.reasonKey)}</> : null}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
