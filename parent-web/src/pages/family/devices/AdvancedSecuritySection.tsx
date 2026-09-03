import { useTranslation } from 'react-i18next';
import { Disclosure } from '../../../components/common/Disclosure';
import { PermissionGate } from '../../../rbac/PermissionGate';
import { PairingConfirmation } from '../DeviceEnrollmentPanel';
import ProtectionAdministrationPanel, {
  type ProtectionAdministrationActions,
  type ProtectionTargetOption,
} from '../ProtectionAdministrationPanel';
import type { DeviceProtectionStatus } from '../../../domain/types';

/**
 * Section 6 -- the technical layer.
 *
 * THE ADMINISTRATION PIN LIVES HERE AND NOWHERE ELSE. It used to render
 * directly beneath the "Add a child device" form, which put a security PIN in
 * the middle of a new parent's very first device setup. It is moved, not
 * removed: the `DISABLE_PROTECTION_POLICY` gate around it is unchanged.
 *
 * Also here: the pairing lookup-by-device-id tool (a support and recovery
 * affordance, not the primary way a device gets connected) and the per-device
 * technical values -- device id, policy revision, trust epoch, key epoch.
 * Those are demoted from the consumer surface, never deleted.
 */
export default function AdvancedSecuritySection({
  familyId,
  devices,
  targets,
  actions,
}: {
  familyId: string;
  devices: DeviceProtectionStatus[] | null;
  targets: ProtectionTargetOption[];
  actions?: ProtectionAdministrationActions;
}) {
  const { t } = useTranslation();
  const list = devices ?? [];

  return (
    <section className="device-section" aria-labelledby="devices-advanced-title">
      <div className="section-panel-head">
        <h2 className="section-panel-title" id="devices-advanced-title">
          {t('devicesPage.tabAdvanced')}
        </h2>
      </div>

      <PermissionGate action="VIEW_DEVICE_ENROLLMENT">
        <ProtectionAdministrationPanel section="advanced" targets={targets} actions={actions} />
      </PermissionGate>

      <div className="section-panel">
        <div className="section-panel-head">
          <h3 className="section-panel-title" id="devices-pairing-tool-title">
            {t('deviceEnrollment.pairingTitle')}
          </h3>
        </div>
        <p>{t('deviceEnrollment.pairingPlain')}</p>
        <p className="field-hint" id="devices-pairing-tool-notice">
          {t('deviceEnrollment.pairingSecurityNotice')}
        </p>
        <PermissionGate action="VIEW_DEVICE_ENROLLMENT">
          <PairingConfirmation
            familyId={familyId}
            idSuffix="advanced"
            describedBy="devices-pairing-tool-notice"
          />
        </PermissionGate>
      </div>

      <div className="section-panel">
        <div className="section-panel-head">
          <h3 className="section-panel-title">{t('devicesPage.technicalDetails')}</h3>
        </div>
        {list.map((device) => (
          <Disclosure key={device.deviceId} summary={device.deviceLabel}>
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
        ))}
      </div>
    </section>
  );
}
