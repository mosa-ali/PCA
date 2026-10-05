import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getApiClients } from '../../../api/client';
import { errorMessageKey } from './enrollmentState';
import { formatDateTime } from '../../../i18n/formatters';
import { useStepUp } from '../../../state/StepUpContext';
import type { FirstDeviceBootstrapCeremonyDto } from '../../../api/deviceEnrollmentClient';

function statusKey(status: FirstDeviceBootstrapCeremonyDto['status']): string {
  switch (status) {
    case 'PENDING': return 'firstDeviceBootstrap.pending';
    case 'APPROVED': return 'firstDeviceBootstrap.approved';
    case 'COMMITTED': return 'firstDeviceBootstrap.committed';
  }
}

/** Parent-only discovery and approval UI; server session/family/owner checks remain authoritative. */
export default function FirstDeviceBootstrapApprovalPanel({ familyId }: { familyId: string }) {
  const { t, i18n } = useTranslation();
  const clients = getApiClients();
  const { requestSensitiveStepUp } = useStepUp();
  const [ceremonies, setCeremonies] = useState<FirstDeviceBootstrapCeremonyDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [actionErrorKey, setActionErrorKey] = useState<string | null>(null);
  const [busyCeremonyId, setBusyCeremonyId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});

  const reload = useCallback(async () => {
    if (!familyId) {
      setLoading(false);
      setErrorKey('deviceEnrollment.errors.sessionUnavailable');
      return;
    }
    setLoading(true);
    setErrorKey(null);
    try {
      setCeremonies(await clients.deviceEnrollment.listFirstDeviceBootstrapCeremonies(familyId));
    } catch (error) {
      setErrorKey(errorMessageKey(error));
    } finally {
      setLoading(false);
    }
  }, [clients.deviceEnrollment, familyId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const approve = async (ceremony: FirstDeviceBootstrapCeremonyDto) => {
    if (!confirmed[ceremony.ceremonyId] || busyCeremonyId !== null) return;
    setActionErrorKey(null);
    setBusyCeremonyId(ceremony.ceremonyId);
    try {
      // Ask for fresh TOTP only after the owner explicitly confirms the fingerprint comparison.
      const stepUpToken = await requestSensitiveStepUp('family.device.bootstrap.root');
      if (!stepUpToken) return;
      const approved = await clients.deviceEnrollment.approveFirstDeviceBootstrap(
        familyId,
        ceremony.ceremonyId,
        stepUpToken,
      );
      setCeremonies((current) => current.map((item) => item.ceremonyId === approved.ceremonyId ? approved : item));
      setConfirmed((current) => ({ ...current, [ceremony.ceremonyId]: false }));
    } catch (error) {
      setActionErrorKey(errorMessageKey(error));
    } finally {
      setBusyCeremonyId(null);
    }
  };

  return (
    <section className="device-section" aria-labelledby="first-device-bootstrap-title">
      <div className="section-panel-head">
        <h3 className="section-panel-title" id="first-device-bootstrap-title">
          {t('firstDeviceBootstrap.title')}
        </h3>
        <button type="button" className="btn btn-secondary" onClick={() => void reload()} disabled={loading}>
          {t('firstDeviceBootstrap.refresh')}
        </button>
      </div>

      <p>{t('firstDeviceBootstrap.intro')}</p>
      <p className="field-hint">{t('firstDeviceBootstrap.securityNotice')}</p>

      {loading && <p role="status">{t('firstDeviceBootstrap.loading')}</p>}
      {errorKey && (
        <div role="alert" className="field-error">
          <p>{t(errorKey)}</p>
          <button type="button" className="btn btn-secondary" onClick={() => void reload()}>
            {t('common.retry')}
          </button>
        </div>
      )}
      {actionErrorKey && <p role="alert" className="field-error">{t(actionErrorKey)}</p>}

      {!loading && !errorKey && ceremonies.length === 0 && (
        <p role="status">{t('firstDeviceBootstrap.empty')}</p>
      )}

      {!errorKey && ceremonies.length > 0 && (
        <div className="fingerprint-grid">
          {ceremonies.map((ceremony) => {
            const expired = Date.parse(ceremony.expiresAt) <= Date.now();
            const canApprove = ceremony.status === 'PENDING' && !expired;
            const busy = busyCeremonyId === ceremony.ceremonyId;
            return (
              <article className="enrollment-panel" key={ceremony.ceremonyId}>
                <dl className="fingerprint-grid">
                  <div>
                    <dt>{t('firstDeviceBootstrap.deviceId')}</dt>
                    <dd className="copyable-value"><bdi dir="ltr"><code>{ceremony.deviceId}</code></bdi></dd>
                  </div>
                  <div>
                    <dt>{t('firstDeviceBootstrap.fingerprint')}</dt>
                    <dd className="copyable-value"><bdi dir="ltr"><code>{ceremony.dskFingerprint}</code></bdi></dd>
                  </div>
                  <div>
                    <dt>{t('firstDeviceBootstrap.createdAt')}</dt>
                    <dd><bdi className="iso">{formatDateTime(ceremony.createdAt, i18n.language)}</bdi></dd>
                  </div>
                  <div>
                    <dt>{t('firstDeviceBootstrap.expiresAt')}</dt>
                    <dd><bdi className="iso">{formatDateTime(ceremony.expiresAt, i18n.language)}</bdi></dd>
                  </div>
                  {ceremony.approvedAt && (
                    <div>
                      <dt>{t('firstDeviceBootstrap.approvedAt')}</dt>
                      <dd><bdi className="iso">{formatDateTime(ceremony.approvedAt, i18n.language)}</bdi></dd>
                    </div>
                  )}
                </dl>

                <p role="status">{t(expired ? 'firstDeviceBootstrap.expired' : statusKey(ceremony.status))}</p>

                {canApprove && (
                  <div className="device-actions">
                    <p className="field-hint">{t('firstDeviceBootstrap.comparePrompt')}</p>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={confirmed[ceremony.ceremonyId] ?? false}
                        onChange={(event) => setConfirmed((current) => ({ ...current, [ceremony.ceremonyId]: event.target.checked }))}
                        disabled={busy}
                      />
                      <span>{t('firstDeviceBootstrap.compareConfirmed')}</span>
                    </label>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void approve(ceremony)}
                      disabled={!confirmed[ceremony.ceremonyId] || busy || busyCeremonyId !== null}
                      aria-busy={busy}
                    >
                      {busy ? t('firstDeviceBootstrap.approving') : t('firstDeviceBootstrap.approve')}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
