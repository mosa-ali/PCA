import { useTranslation } from 'react-i18next';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { AsyncStates } from '../../components/common/States';
import { ProtectionAlertPanel } from '../security/ProtectionAlertPanel';

/**
 * ALERTS.
 *
 * Security and protection alerts were previously reachable only by scrolling
 * to the bottom of /security/status, which meant the one place a parent goes
 * when something is wrong had no address of its own. This page gives them one,
 * and it is where the dashboard's "Important alerts" tile now points.
 *
 * It renders the existing ProtectionAlertPanel unchanged, including its honest
 * PENDING_TRUSTED_DECRYPTION state: alerts are decrypted only by the trusted
 * parent context, and until that inbox exists the panel says so rather than
 * showing a fabricated empty list.
 *
 * A read that fails closed (untrusted endpoint, crypto review pending) is
 * rendered by AsyncStates as the action-needed state -- blue, with a next
 * step -- not as "Something went wrong".
 */
export default function Alerts() {
  const { t } = useTranslation();
  const clients = getApiClients();
  const { data, loading, error, reload } = useAsync(() => clients.protectionAlertDelivery.list(), []);

  return (
    <section aria-labelledby="alerts-title">
      <h1 id="alerts-title">{t('alertsPage.title')}</h1>
      <AsyncStates loading={loading} error={error} onRetry={reload}>
        {/*
          `overflow-wrap: anywhere` is inherited, and it is here for a measured
          reason. ProtectionAlertPanel renders `notifications.payloadNote`,
          whose copy cites the internal path
          "docs/architecture/09_SECURITY_PRIVACY_E2EE.md" -- a 46-character
          token with no break opportunity. At 320px it overflowed its column by
          106px (measured in a real browser: client=254, scroll=360), taking
          the document's scrollWidth to 393 against a 320px viewport.

          Nobody had seen it because /security/status, the panel's only other
          host, fails closed before it ever reaches the panel. This page
          renders the panel unconditionally, so it surfaces here first.

          Contained at this page's boundary rather than by editing the shared
          panel or its copy, neither of which this writer owns. The underlying
          defect -- parent-facing copy quoting an internal document path -- is
          raised separately; it is a content problem, not a layout one.
        */}
        <div style={{ overflowWrap: 'anywhere' }}>
          <ProtectionAlertPanel
            alerts={data?.status === 'READY' ? data.alerts : []}
            feedState={data?.status === 'READY' ? 'READY' : 'PENDING_TRUSTED_DECRYPTION'}
          />
        </div>
      </AsyncStates>
    </section>
  );
}
