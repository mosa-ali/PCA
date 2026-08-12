import { useTranslation } from 'react-i18next';
import { useIsOnline } from '../../hooks/useIsOnline';
import { isOfflinePolicySigningBlocked } from '../../domain/offlinePolicyAuthoring';

/**
 * Shown on policy-edit pages while the browser is offline. Real offline
 * signing (turning a LOCAL_DRAFT into something queueable while
 * disconnected) requires a trusted-browser-held signing key and a reviewed
 * production crypto suite that this repository slice does not have --
 * see ../../domain/offlinePolicyAuthoring.ts (PARENT_OFFLINE_POLICY_SIGNING).
 * This component only ever tells the parent the edit will sync once
 * reconnected; it never performs or claims to perform offline signing.
 */
export function OfflineDraftNotice() {
  const { t } = useTranslation();
  const online = useIsOnline();
  if (online) return null;

  return (
    <div className="offline-draft-notice card" role="status">
      <p>{t('offline.editWillSyncWhenReconnected')}</p>
      {isOfflinePolicySigningBlocked() && <p>{t('offline.requiresTrustedBrowser')}</p>}
    </div>
  );
}
