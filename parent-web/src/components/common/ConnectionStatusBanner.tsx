import { useTranslation } from 'react-i18next';
import { useReconnectSync } from '../../hooks/useReconnectSync';

/**
 * App-shell-level connection indicator. Shows a persistent notice while the
 * browser itself is offline (the app shell still launches -- see
 * public/offline.html and vite.config.ts PWA setup -- but interactive data
 * cannot refresh), and a single, dismissible, non-repeating summary once a
 * reconnect pass finishes (see ../../hooks/useReconnectSync.ts). Never
 * floods the UI with one toast per sub-step of the reconnect sequence.
 */
export function ConnectionStatusBanner() {
  const { t } = useTranslation();
  const { connectivity, lastReconnectMessage, dismiss } = useReconnectSync();

  if (connectivity === 'offline') {
    return (
      <div className="connection-banner connection-banner-offline" role="status">
        {t('offline.appOfflineNote')}
      </div>
    );
  }

  if (lastReconnectMessage) {
    return (
      <div className="connection-banner connection-banner-reconnected" role="status">
        <span>{t(lastReconnectMessage)}</span>
        <button type="button" className="btn btn-inline" onClick={dismiss}>
          {t('common.close')}
        </button>
      </div>
    );
  }

  return null;
}
