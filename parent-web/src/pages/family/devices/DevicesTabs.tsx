import { useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getApiClients } from '../../../api/client';
import { config } from '../../../config/env';
import { cookieSessionFamilyId } from '../../../api/real/realBillingClient';
import { RealProtectionAdministrationActions } from '../../../api/real/realProtectionAdministrationActions';
import { useAsync } from '../../../hooks/useAsync';
import { useAuth } from '../../../state/AuthContext';
import { Tabs, type TabDefinition } from '../../../components/common/Tabs';
import { PermissionGate } from '../../../rbac/PermissionGate';
import OverviewSection from './OverviewSection';
import AddDeviceWizard from './AddDeviceWizard';
import PendingSetupSection from './PendingSetupSection';
import ExistingDevicesSection from './ExistingDevicesSection';
import ProtectionRemovalSection from './ProtectionRemovalSection';
import AdvancedSecuritySection from './AdvancedSecuritySection';
import type { ProtectionTargetOption } from '../ProtectionAdministrationPanel';

/**
 * `/family/devices` used to stack SIX workflows in one scroll -- create
 * invitation, invitations list, confirm device pairing, Administration-PIN
 * setup, request a parent decision, and pending/decided requests -- plus the
 * device table and a trailing error paragraph. This splits them into six
 * sections of which exactly one is visible at a time.
 *
 * Tab state lives in the URL as `?section=…`, NOT in a new route: a section is
 * linkable, reload-safe and breadcrumb-consistent without touching `App.tsx`
 * or the nav config.
 *
 * WHERE EVERY AUTHORIZATION BOUNDARY WENT (none was dropped):
 *   VIEW_DEVICE_ENROLLMENT     -> AddDeviceWizard, PendingSetupSection,
 *                                 ProtectionRemovalSection, AdvancedSecuritySection
 *                                 (the two panels it used to wrap on this page)
 *   CREATE_DEVICE_INVITATION   -> AddDeviceWizard
 *   REVOKE_DEVICE_INVITATION   -> PendingSetupSection (per invitation row)
 *   CONFIRM_DEVICE_PAIRING     -> PairingConfirmation (used by pending + advanced)
 *   REMOVE_OR_REVOKE_DEVICE    -> ProtectionRemovalSection (per device row)
 *   DISABLE_PROTECTION_POLICY  -> ProtectionAdministrationPanel, both sections
 */

export type DevicesSectionId = 'overview' | 'add' | 'pending' | 'devices' | 'protection' | 'advanced';

const SECTIONS: readonly { id: DevicesSectionId; labelKey: string }[] = [
  { id: 'overview', labelKey: 'devicesPage.tabOverview' },
  { id: 'add', labelKey: 'devicesPage.tabAddDevice' },
  { id: 'pending', labelKey: 'devicesPage.tabPending' },
  { id: 'devices', labelKey: 'devicesPage.tabDevices' },
  { id: 'protection', labelKey: 'devicesPage.tabProtection' },
  { id: 'advanced', labelKey: 'devicesPage.tabAdvanced' },
];

function isSectionId(value: string | null): value is DevicesSectionId {
  return SECTIONS.some((section) => section.id === value);
}

export default function DevicesTabs() {
  const { t } = useTranslation();
  const clients = getApiClients();
  const { session } = useAuth();
  const familyId = session?.familyId ?? '';

  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('section');
  const activeSection: DevicesSectionId = isSectionId(requested) ? requested : 'overview';

  const goToSection = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('section', id);
    // `replace` so walking the tab strip with Arrow keys does not fill the
    // browser's back stack with six entries.
    setSearchParams(next, { replace: true });
  };

  const {
    data: devices,
    loading: devicesLoading,
    error: devicesError,
    reload: reloadDevices,
  } = useAsync(() => clients.deviceStatus.listDeviceStatuses(), []);

  // Fail-closed by design in real mode (see AddDeviceWizard's step-0 gate).
  // `null` here means "we could not read it", which is NOT the same as "there
  // are no children" -- every consumer below is required to tell them apart.
  const { data: dashboard, error: dashboardError } = useAsync(
    () => clients.parentFamilyData.getDashboard(),
    [],
  );
  const familyChildren = dashboardError ? null : dashboard?.children ?? null;

  const targets: ProtectionTargetOption[] = (devices ?? []).map((device) => ({
    childId: device.childId,
    childLabel: familyChildren?.find((child) => child.childId === device.childId)?.displayName ?? device.childId,
    deviceId: device.deviceId,
    deviceLabel: device.deviceLabel,
    protectionLevel: device.protectionState,
  }));
  // The real actions binding reads the target list lazily on every call, so it
  // must see the CURRENT targets rather than the ones that existed when it was
  // constructed -- otherwise a decision could be validated against a stale
  // child/device pairing.
  const targetsRef = useRef<ProtectionTargetOption[]>(targets);
  targetsRef.current = targets;

  // Demo mode has no authenticated family-session cookie to bind against, so
  // the panel is left in its honest "binding not installed" state there,
  // exactly as its own doc comment describes -- never a fabricated demo
  // implementation of a real authenticated family action.
  const protectionActions = useMemo(
    () =>
      clients.isFixtureBacked
        ? undefined
        : new RealProtectionAdministrationActions(
            config.apiBaseUrl,
            () => cookieSessionFamilyId(config.apiBaseUrl),
            () => targetsRef.current,
          ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clients.isFixtureBacked],
  );

  const tabs: TabDefinition[] = SECTIONS.map((section) => ({ id: section.id, label: t(section.labelKey) }));

  return (
    <Tabs
      label={t('devicesPage.sectionsLabel')}
      tabs={tabs}
      activeId={activeSection}
      onSelect={goToSection}
      idPrefix="devices-section"
    >
      {activeSection === 'overview' && (
        <OverviewSection
          devices={devices}
          loading={devicesLoading}
          error={devicesError}
          onRetry={reloadDevices}
          familyChildren={familyChildren}
          onGoToSection={goToSection}
        />
      )}
      {/* At HEAD, Devices.tsx wrapped BOTH DeviceEnrollmentPanel (create + the invitation
          list + pairing) AND ProtectionAdministrationPanel in a single outer
          VIEW_DEVICE_ENROLLMENT gate. Re-sectioning preserved every action STRING but
          narrowed that gate's SCOPE to the protection/advanced sections, so a family
          member without VIEW_DEVICE_ENROLLMENT could reach the Add-device and
          Pending-setup surfaces. The server still enforces LIST_OWN_INVITATIONS and
          CREATE_INVITATION independently, so this was never a data exposure -- but the
          client gate is defence in depth and it must not silently shrink. Restored to
          the HEAD scope. */}
      {activeSection === 'add' && (
        <PermissionGate action="VIEW_DEVICE_ENROLLMENT">
          <AddDeviceWizard familyId={familyId} onGoToSection={goToSection} />
        </PermissionGate>
      )}
      {activeSection === 'pending' && (
        <PermissionGate action="VIEW_DEVICE_ENROLLMENT">
          <PendingSetupSection familyId={familyId} onGoToSection={goToSection} />
        </PermissionGate>
      )}
      {activeSection === 'devices' && (
        <ExistingDevicesSection
          devices={devices}
          loading={devicesLoading}
          error={devicesError}
          onRetry={reloadDevices}
          familyChildren={familyChildren}
        />
      )}
      {activeSection === 'protection' && (
        <ProtectionRemovalSection
          devices={devices}
          familyChildren={familyChildren}
          targets={targets}
          actions={protectionActions}
        />
      )}
      {activeSection === 'advanced' && (
        <AdvancedSecuritySection
          familyId={familyId}
          devices={devices}
          targets={targets}
          actions={protectionActions}
        />
      )}
    </Tabs>
  );
}
