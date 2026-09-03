import { useTranslation } from 'react-i18next';
import { AsyncStates } from '../../../components/common/States';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { Disclosure } from '../../../components/common/Disclosure';
import { NO_VALUE } from '../../../i18n/formatters';
import type { ChildSummary, DeviceProtectionStatus } from '../../../domain/types';

/**
 * Section 4 -- the devices a family already has, with consumer-facing columns
 * only.
 *
 * `Policy revision` and `Epoch` used to be TABLE COLUMNS here, so a parent
 * opening Devices was met with `trust 4 / key 2` before anything they could
 * act on. Those values are not deleted: they moved into the per-row Technical
 * details disclosure below and are also listed on the Advanced & security
 * section, which is where a technical name is the correct name.
 *
 * The Child column is the display name when the family read resolved. When
 * that read declined (fail-closed, by design, in real mode) it shows a dash --
 * NOT the raw `childId`. A device row must not put an internal identifier on a
 * parent's screen just because the friendly name was unavailable; the id is in
 * the disclosure.
 */
export default function ExistingDevicesSection({
  devices,
  loading,
  error,
  onRetry,
  familyChildren,
}: {
  devices: DeviceProtectionStatus[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  familyChildren: ChildSummary[] | null;
}) {
  const { t } = useTranslation();

  return (
    <section className="device-section" aria-labelledby="devices-list-title">
      <div className="section-panel-head">
        <h2 className="section-panel-title" id="devices-list-title">
          {t('devicesPage.tabDevices')}
        </h2>
      </div>

      <AsyncStates
        loading={loading}
        error={error}
        onRetry={onRetry}
        empty={!devices || devices.length === 0}
      >
        <div className="table-scroll">
          <table className="data-table responsive-cards">
            <thead>
              <tr>
                <th scope="col">{t('devicesTable.device')}</th>
                <th scope="col">{t('protectionAdministration.child')}</th>
                <th scope="col">{t('devicesTable.os')}</th>
                <th scope="col">{t('devicesTable.protection')}</th>
                <th scope="col">{t('devicesPage.technicalDetails')}</th>
              </tr>
            </thead>
            <tbody>
              {(devices ?? []).map((device) => {
                const childName =
                  familyChildren?.find((child) => child.childId === device.childId)?.displayName ?? null;
                return (
                  <tr key={device.deviceId}>
                    <td data-label={t('devicesTable.device')}>
                      <bdi className="iso">{device.deviceLabel}</bdi>
                    </td>
                    <td data-label={t('protectionAdministration.child')}>
                      {childName ? <bdi className="iso">{childName}</bdi> : NO_VALUE}
                    </td>
                    {/* Rendered the raw `ANDROID` / `IOS` enum before. */}
                    <td data-label={t('devicesTable.os')}>{t(`devicesTable.osFamily.${device.osFamily}`)}</td>
                    <td data-label={t('devicesTable.protection')}>
                      <StatusBadge state={device.protectionState} />
                    </td>
                    <td data-label={t('devicesPage.technicalDetails')}>
                      <Disclosure summary={t('devicesPage.technicalDetails')}>
                        <ul className="plain-list technical-details">
                          <li>
                            {t('deviceEnrollment.deviceId')}: <bdi className="iso">{device.deviceId}</bdi>
                          </li>
                          <li>
                            {t('devicesTable.policyRevision')}: {device.lastAcknowledgedPolicyRevision}
                          </li>
                          <li>
                            {t('devicesTable.epoch')}:{' '}
                            {t('devicesTable.epochValue', { trust: device.trustSetEpoch, key: device.keyEpoch })}
                          </li>
                        </ul>
                      </Disclosure>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </AsyncStates>
    </section>
  );
}
