import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../../components/common/States';
import { PermissionGate } from '../../../rbac/PermissionGate';
import ProtectionAdministrationPanel, {
  type ProtectionAdministrationActions,
  type ProtectionTargetOption,
} from '../ProtectionAdministrationPanel';
import type { ChildSummary, DeviceProtectionStatus } from '../../../domain/types';

/**
 * Section 5 -- everything that CHANGES a device's protection or removes it, in
 * one place.
 *
 * `devicesTable.removalNotice` used to float as a bare grey paragraph above the
 * device table; it is shown once here, at the top of the section it actually
 * governs.
 *
 * The `REMOVE_OR_REVOKE_DEVICE` gate is per row, exactly as it was when the
 * button lived in the device table -- the control moved section, its
 * authorization boundary did not move with the styling.
 */
export default function ProtectionRemovalSection({
  devices,
  familyChildren,
  targets,
  actions,
}: {
  devices: DeviceProtectionStatus[] | null;
  familyChildren: ChildSummary[] | null;
  targets: ProtectionTargetOption[];
  actions?: ProtectionAdministrationActions;
}) {
  const { t } = useTranslation();
  const [removingDeviceId, setRemovingDeviceId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const removeDevice = async (
    deviceId: string,
    childId: string,
    protectionLevel: ProtectionTargetOption['protectionLevel'],
  ) => {
    if (!actions) return;
    setRemoveError(null);
    setRemovingDeviceId(deviceId);
    try {
      await actions.requestApproval({
        childId,
        deviceId,
        protectionLevel,
        operation: 'REMOVE_REVOKE_DEVICE',
        reasonCategory: null,
      });
    } catch {
      // `devicesTable.removeRequestFailed` now exists in BOTH locales, so the
      // English `defaultValue` fallback is no longer the string an Arabic
      // parent actually reads.
      setRemoveError(t('devicesTable.removeRequestFailed'));
    } finally {
      setRemovingDeviceId(null);
    }
  };

  const list = devices ?? [];

  return (
    <section className="device-section" aria-labelledby="devices-protection-title">
      <div className="section-panel-head">
        <h2 className="section-panel-title" id="devices-protection-title">
          {t('devicesPage.tabProtection')}
        </h2>
      </div>

      <div className="banner banner-neutral">
        <div className="banner-body">
          <p className="banner-text">{t('devicesTable.removalNotice')}</p>
        </div>
      </div>

      <div className="section-panel">
        <div className="section-panel-head">
          <h3 className="section-panel-title">{t('protectionAdministration.removeDevice')}</h3>
        </div>
        {list.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="plain-list">
            {list.map((device) => {
              const childName =
                familyChildren?.find((child) => child.childId === device.childId)?.displayName ?? null;
              return (
                <li key={device.deviceId} className="web-rule-list-item">
                  <span>
                    <bdi className="iso">{device.deviceLabel}</bdi>
                    {childName && (
                      <>
                        {' — '}
                        <bdi className="iso">{childName}</bdi>
                      </>
                    )}
                  </span>
                  <PermissionGate action="REMOVE_OR_REVOKE_DEVICE" showDisabledFallback>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={!actions || removingDeviceId === device.deviceId}
                      onClick={() =>
                        void removeDevice(device.deviceId, device.childId, device.protectionState)
                      }
                    >
                      {t('common.delete')}
                    </button>
                  </PermissionGate>
                </li>
              );
            })}
          </ul>
        )}
        {removeError && (
          <p className="field-error" role="alert">
            {removeError}
          </p>
        )}
      </div>

      {/* The parent-decision workflow (request + pending/decided list). The
          Administration PIN is deliberately NOT here -- it is on the Advanced
          & security section, so a security PIN is never in the middle of a
          normal protection decision. */}
      <PermissionGate action="VIEW_DEVICE_ENROLLMENT">
        <ProtectionAdministrationPanel section="protection" targets={targets} actions={actions} />
      </PermissionGate>
    </section>
  );
}
