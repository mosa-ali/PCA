import { useTranslation } from 'react-i18next';

export type ParentProtectionAlertTrigger =
  | 'DISABLE_OR_REMOVAL_REQUESTED'
  | 'REPEATED_INVALID_PIN'
  | 'AUTHORITY_CHANGE'
  | 'CRITICAL_PERMISSION_OR_VPN_LOST'
  | 'UNEXPECTED_OFFLINE'
  | 'TIME_TAMPERING'
  | 'PROTECTION_DEGRADED'
  | 'REINSTALLATION'
  | 'INVITATION_REDEEMED'
  | 'UNENROLLMENT';

/** Decrypted only by the trusted parent context; no readable detail field is permitted. */
export interface ParentProtectionAlert {
  readonly alertId: string;
  readonly deviceId: string | null;
  readonly trigger: ParentProtectionAlertTrigger;
  readonly generatedAtUtc: string;
}

const TRIGGER_LABELS: Record<ParentProtectionAlertTrigger, string> = {
  DISABLE_OR_REMOVAL_REQUESTED: 'Disable or removal requested',
  REPEATED_INVALID_PIN: 'Repeated invalid PIN',
  AUTHORITY_CHANGE: 'Authorization or management authority changed',
  CRITICAL_PERMISSION_OR_VPN_LOST: 'Critical permission or VPN capability lost',
  UNEXPECTED_OFFLINE: 'Unexpected offline state',
  TIME_TAMPERING: 'Time tampering detected',
  PROTECTION_DEGRADED: 'Protection degraded',
  REINSTALLATION: 'Reinstallation detected',
  INVITATION_REDEEMED: 'Invitation redeemed',
  UNENROLLMENT: 'Unenrollment',
};

interface ProtectionAlertPanelProps {
  alerts: readonly ParentProtectionAlert[];
  feedState: 'READY' | 'PENDING_TRUSTED_DECRYPTION';
}

/**
 * Parent-facing display for the typed event metadata. `PENDING_TRUSTED_DECRYPTION`
 * is the honest state until a real trusted-parent E2EE inbox supplies the
 * already-decrypted category/time records; it is never replaced by a demo
 * alert or by plaintext fetched from PCA infrastructure.
 */
export function ProtectionAlertPanel({ alerts, feedState }: ProtectionAlertPanelProps) {
  const { t, i18n } = useTranslation();
  return (
    <section className="card" aria-labelledby="protection-alerts-title">
      <h2 id="protection-alerts-title">Security and protection alerts</h2>
      <p>{t('notifications.payloadNote')}</p>
      {feedState === 'PENDING_TRUSTED_DECRYPTION' && (
        <p role="status">Alerts are waiting for decryption by a trusted parent device.</p>
      )}
      {feedState === 'READY' && alerts.length === 0 && <p>No security alerts are available.</p>}
      {alerts.length > 0 && (
        <ul className="plain-list">
          {alerts.map((alert) => (
            <li key={alert.alertId}>
              <strong>{TRIGGER_LABELS[alert.trigger]}</strong>{' '}
              <span style={{ color: 'var(--color-text-muted)' }}>
                {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(alert.generatedAtUtc))}
              </span>
              {alert.deviceId !== null && <span className="sr-only"> Device alert</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
