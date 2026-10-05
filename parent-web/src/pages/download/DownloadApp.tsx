import { useTranslation } from 'react-i18next';
import { config } from '../../config/env';
import { ActionNeededState } from '../../components/common/States';

/**
 * DOWNLOAD PCA CHILD APP.
 *
 * The header's "Download App" action is global and always visible, and it
 * lands here rather than on an assumed store page. Parent's selected external
 * destination is the public /child-app/ status page; that page can remain
 * useful while signed Android installation is not available yet. This page
 * keeps the distinction clear:
 *
 *   Android, public status page configured      -> a real link to that URL.
 *   Android, nothing configured                 -> say so, in one sentence.
 *   iOS                                         -> planned for a later
 *                                                  release. TEXT ONLY.
 *
 * Two rules hold in every branch:
 *
 * 1. NO FABRICATED URL. There is no hardcoded package, app-store link, or
 *    stand-in host in this file. The only `href` it can ever emit is
 *    `config.childAppDistributionUrl`, which config/env.ts has already parsed and
 *    scheme-checked (http/https only, everything else -- `javascript:` and
 *    `data:` included -- becomes `null`). A URL that fails that check is
 *    treated exactly like an unset one: this page then says nothing is
 *    configured, rather than rendering a link it cannot vouch for.
 *
 * 2. NO ACTIVE iOS INSTALLATION ACTION. The iOS section is a statement, not a
 *    control: no link, no button, no "notify me". iOS is post-V1 and the
 *    backend refuses `platform=IOS` with PLATFORM_ENROLLMENT_UNAVAILABLE, so
 *    any iOS install affordance would lead a parent to an app that cannot be
 *    enrolled.
 *
 * Presentation reuses `ActionNeededState` (components/common/States.tsx) for
 * both "not available yet" cases -- blue, `role="status"`, never red and never
 * `role="alert"`. Neither of these is a failure: the system is working
 * correctly and is declining to claim a capability it does not have.
 * `showReassurance` is false in both because "nothing was lost" is about data
 * that was withheld, and nothing was withheld here.
 */
export default function DownloadApp() {
  const { t } = useTranslation();
  const androidDestination = config.childAppDistributionUrl;
  const androidDistributionKind = config.childAppDistributionKind;

  return (
    <section aria-labelledby="download-app-title">
      <h1 id="download-app-title">{t('downloadApp.title')}</h1>
      <p>{t('downloadApp.intro')}</p>

      {androidDestination === null ? (
        <ActionNeededState
          titleKey="downloadApp.androidTitle"
          bodyKey="downloadApp.androidNotConfigured"
          showReassurance={false}
        />
      ) : (
        <article className="card">
          <h2 className="card-title">{t('downloadApp.androidTitle')}</h2>
          <p className="card-body">
            {t(androidDistributionKind === 'local-test'
              ? 'downloadApp.androidLocalTest'
              : 'downloadApp.androidLandingPage')}
          </p>
          <a className="btn btn-secondary btn-download-app" href={androidDestination} rel="noreferrer">
            {t(androidDistributionKind === 'local-test'
              ? 'shell.downloadAppAndroid'
              : 'downloadApp.viewInstallationOptions')}
          </a>
          {/* The same URL as text, for a parent typing it on the child's
              device. `dir="ltr"` so an opaque Latin URL is never reordered by
              an RTL paragraph -- same treatment as the enrollment wizard's
              copyable values. */}
          <p className="copyable-value">
            <code dir="ltr">{androidDestination}</code>
          </p>
        </article>
      )}

      {/* iOS. Deliberately identical presentation to the Android
          not-configured case and deliberately childless: nothing inside this
          block is clickable. */}
      <ActionNeededState
        titleKey="downloadApp.iosTitle"
        bodyKey="downloadApp.iosPlanned"
        showReassurance={false}
      />

      <p className="text-muted">{t('downloadApp.honestyNotice')}</p>
    </section>
  );
}
