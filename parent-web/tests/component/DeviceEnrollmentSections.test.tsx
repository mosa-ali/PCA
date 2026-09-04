import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n, { applyDocumentDirection } from '../../src/i18n';
import { renderWithProviders } from '../utils/renderWithProviders';
import Devices from '../../src/pages/family/Devices';
import { getApiClients } from '../../src/api/client';
import { EndpointNotTrustedError } from '../../src/api/familyDataAccessErrors';
import { ChildProfileError } from '../../src/api/childProfileClient';
import { __resetDevDeviceEnrollmentState } from '../../src/api/dev/devDeviceEnrollmentClient';
import { __resetDevChildProfileState, __seedDevChildProfile } from '../../src/api/dev/devChildProfileClient';
import { __resetChildLabelsForTest, setChildLabel } from '../../src/domain/childLabels';

/**
 * `/family/devices` used to stack SIX workflows plus a device table plus a
 * trailing error paragraph in one scroll. This file pins the sectioning that
 * fixed it, and the two honesty defects the owner named:
 *
 *   - the Administration PIN is no longer in a new parent's first device
 *     setup; it appears in Advanced & security and NOWHERE else,
 *   - a deliberately fail-closed family-data read renders the action-needed
 *     treatment with a real next step, not "Something went wrong", and not a
 *     dead "No child profiles available" dropdown.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../src');

const TAB_NAMES = [
  'Overview',
  'Add device',
  'Pending setup',
  'Devices',
  'Protection & removal',
  'Advanced & security',
];

describe('Devices page sectioning', () => {
  beforeEach(() => {
    __resetDevDeviceEnrollmentState();
    __resetDevChildProfileState();
    __resetChildLabelsForTest();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it('keeps the page heading exactly "Devices" and exposes the six sections as real tabs', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices' });

    expect(screen.getByRole('heading', { level: 1, name: 'Devices' })).toBeInTheDocument();
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(TAB_NAMES);
    expect(screen.getByRole('tablist')).toHaveAccessibleName('Device sections');

    // Roving tabindex: exactly one tab is in the page tab order.
    expect(tabs.filter((tab) => tab.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  });

  it('defaults to Overview and honours ?section= so a section is linkable', async () => {
    const { unmount } = renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices' });
    expect(await screen.findByRole('tab', { name: 'Overview', selected: true })).toBeInTheDocument();
    unmount();

    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=advanced' });
    expect(await screen.findByRole('tab', { name: 'Advanced & security', selected: true })).toBeInTheDocument();
  });

  it('the Administration PIN appears in Advanced & security and in no other section', async () => {
    for (const section of ['overview', 'add', 'pending', 'devices', 'protection']) {
      const { unmount } = renderWithProviders(<Devices />, {
        role: 'OWNER',
        route: `/family/devices?section=${section}`,
      });
      await screen.findByRole('tablist');
      expect(
        screen.queryAllByLabelText('Administration PIN'),
        `PIN must not be on ?section=${section}`,
      ).toHaveLength(0);
      expect(screen.queryByRole('button', { name: 'Save Administration PIN' })).toBeNull();
      unmount();
    }

    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=advanced' });
    // `selector: 'input'` because the fieldset's legend carries the same name.
    expect(await screen.findByLabelText('Administration PIN', { selector: 'input' })).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm Administration PIN')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Administration PIN' })).toBeInTheDocument();
  });

  it('shows one workflow at a time -- the Add-device wizard is alone on its section', async () => {
    // A real child must already exist for the wizard body to render at all --
    // otherwise this section correctly shows "Add your first child" (its own,
    // separately-tested empty state) instead.
    __seedDevChildProfile('dev-family-1', 'child-existing-1');
    setChildLabel('child-existing-1', 'Existing Child (DEV)');
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=add' });

    expect(await screen.findByRole('heading', { level: 3, name: 'Who is this device for?' })).toBeInTheDocument();
    // None of the other five workflows is on screen with it.
    expect(screen.queryAllByLabelText('Administration PIN')).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'Request a parent decision' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Pending and decided requests' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Invitations' })).toBeNull();
    expect(screen.queryByLabelText('Device ID')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('the engineer-facing device values are demoted to a disclosure, not deleted', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=devices' });

    const table = await screen.findByRole('table');
    const headers = Array.from(table.querySelectorAll('th')).map((th) => th.textContent);
    expect(headers).toEqual(['Device', 'Child', 'OS', 'Protection', 'Technical details']);

    // Still present, one click away, on both the row and the advanced section.
    const disclosures = screen.getAllByText('Technical details');
    expect(disclosures.length).toBeGreaterThan(1);
    expect(table.textContent).toContain('Policy revision');
    expect(table.textContent).toContain('Epoch');
  });

  it('the removal notice is shown once, on the section that governs it', async () => {
    const { unmount } = renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=devices' });
    await screen.findByRole('table');
    expect(screen.queryByText(/Removing or revoking a child device changes family trust/)).toBeNull();
    unmount();

    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=protection' });
    expect(
      await screen.findByText(/Removing or revoking a child device changes family trust/),
    ).toBeInTheDocument();
  });
});

describe('Devices page -- a fail-closed family read is not an error and not an empty list', () => {
  beforeEach(() => {
    __resetDevDeviceEnrollmentState();
    __resetDevChildProfileState();
    __resetChildLabelsForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function failFamilyDataClosed() {
    const clients = getApiClients();
    vi.spyOn(clients.parentFamilyData, 'getDashboard').mockRejectedValue(
      new EndpointNotTrustedError('BROWSER_NOT_TRUSTED', 'ParentFamilyDataGateway.getDashboard'),
    );
  }

  // PPR-2: Add device no longer sources its child list from getDashboard() --
  // that read is gated behind the trusted-browser crypto boundary, which is a
  // SEPARATE concern from "can this parent see and manage their children"
  // (see AddDeviceWizard.tsx's own header comment). childProfileRoutes.ts
  // sits on the ordinary service-session + family-authorization plane, so
  // the realistic failure here is a genuine session/authority problem, not
  // a deliberate fail-closed condition -- which is why it now renders as a
  // real error, not an action-needed state. The getDashboard() fail-closed
  // scenario itself is still real and still tested below, against a section
  // that still depends on that read (overview's offline count).
  function failChildProfilesListClosed() {
    const clients = getApiClients();
    vi.spyOn(clients.childProfiles, 'listChildProfiles').mockRejectedValue(
      new ChildProfileError('UNAUTHORIZED', 'listChildProfiles: your service session has expired or is invalid. Please sign in again.', 401),
    );
  }

  it('a genuine child-registry failure renders a real, retryable error -- never the old dead-end text', async () => {
    failChildProfilesListClosed();
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=add' });

    const alert = await screen.findByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();

    // And emphatically NOT the old dead end this file's header describes.
    expect(screen.queryByText('No child profiles available')).toBeNull();
  });

  it('an empty (but successfully read) child registry offers Add your first child, never a disabled dropdown', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=add' });

    const headline = await screen.findByRole('heading', { name: 'Add your first child' });
    expect(headline).toBeInTheDocument();

    const action = screen.getByRole('button', { name: 'Someone new' });
    expect(action).toBeInTheDocument();

    const block = headline.closest('.state-block') as HTMLElement;
    expect(block).toHaveAttribute('role', 'status');
    expect(block.className).toContain('state-action-needed');
    expect(screen.queryByText('Something went wrong')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('No child profiles available')).toBeNull();
  });

  it('the overview shows a dash and "cannot verify", never 0, for a count it could not read', async () => {
    failFamilyDataClosed();
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=overview' });

    const offlineLabel = await screen.findByText('Offline');
    const item = offlineLabel.closest('.device-summary-item') as HTMLElement;
    expect(item.textContent).toContain('—');
    expect(item.textContent).toContain("We can't verify this right now");
    expect(item.textContent).not.toContain('0');

    // The counts that DID resolve are still real numbers.
    const total = screen.getByText('Devices', { selector: '.kpi-label' }).closest('.device-summary-item');
    expect(total?.textContent).not.toContain('—');
  });
});

describe('Devices page tabs -- RTL arrow-key direction', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it('follows the resolved document direction: ArrowLeft advances under dir="rtl"', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');

    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices' });
    const tabs = await screen.findAllByRole('tab');
    tabs[0].focus();

    // In RTL the strip is painted right-to-left, so ArrowLeft must move to the
    // NEXT tab -- the one visually to the left.
    await userEvent.keyboard('{ArrowLeft}');
    await waitFor(() => expect(tabs[1]).toHaveAttribute('aria-selected', 'true'));
    expect(document.activeElement).toBe(tabs[1]);

    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(tabs[0]).toHaveAttribute('aria-selected', 'true'));
    expect(document.activeElement).toBe(tabs[0]);
  });

  it('uses the opposite mapping under dir="ltr"', async () => {
    applyDocumentDirection('en');
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices' });
    const tabs = await screen.findAllByRole('tab');
    tabs[0].focus();

    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(tabs[1]).toHaveAttribute('aria-selected', 'true'));

    await userEvent.keyboard('{End}');
    await waitFor(() => expect(tabs[tabs.length - 1]).toHaveAttribute('aria-selected', 'true'));
  });
});

describe('Devices page -- every authorization boundary survived the re-sectioning', () => {
  // A hidden or restyled button is never authorization. Moving a control
  // between sections must not drop its gate, so each `action` string is pinned
  // to the file that now renders it.
  const EXPECTED_GATES: Readonly<Record<string, readonly string[]>> = {
    'pages/family/devices/AddDeviceWizard.tsx': ['CREATE_DEVICE_INVITATION'],
    'pages/family/devices/PendingSetupSection.tsx': ['REVOKE_DEVICE_INVITATION'],
    'pages/family/devices/ProtectionRemovalSection.tsx': ['REMOVE_OR_REVOKE_DEVICE', 'VIEW_DEVICE_ENROLLMENT'],
    'pages/family/devices/AdvancedSecuritySection.tsx': ['VIEW_DEVICE_ENROLLMENT'],
    // Restored after re-sectioning narrowed this gate. At HEAD, Devices.tsx wrapped the
    // WHOLE enrollment surface -- create, the invitation list and pairing -- in one outer
    // VIEW_DEVICE_ENROLLMENT gate. Splitting into tabs preserved every action STRING while
    // shrinking that gate's SCOPE, which is a class of regression a string-presence check
    // cannot see. DevicesTabs is where the outer gate now lives, so it is pinned here.
    'pages/family/devices/DevicesTabs.tsx': ['VIEW_DEVICE_ENROLLMENT'],
    'pages/family/DeviceEnrollmentPanel.tsx': ['CONFIRM_DEVICE_PAIRING'],
    'pages/family/ProtectionAdministrationPanel.tsx': ['DISABLE_PROTECTION_POLICY'],
  };

  it.each(Object.entries(EXPECTED_GATES))('%s keeps its PermissionGate action strings', (file, actions) => {
    const source = readFileSync(resolve(SRC, file), 'utf8');
    for (const action of actions) {
      expect(source, `${file} must gate on ${action}`).toContain(`action="${action}"`);
    }
  });

  it('the Administration PIN fieldset is still gated on DISABLE_PROTECTION_POLICY', () => {
    const source = readFileSync(resolve(SRC, 'pages/family/ProtectionAdministrationPanel.tsx'), 'utf8');
    // Both halves of the panel (PIN, and the parent-decision request) keep it.
    const occurrences = source.split('action="DISABLE_PROTECTION_POLICY"').length - 1;
    expect(occurrences).toBe(2);
  });

  it('no iOS enrollment path exists in the Add-device journey', () => {
    const source = readFileSync(resolve(SRC, 'pages/family/devices/AddDeviceWizard.tsx'), 'utf8');
    expect(source).not.toMatch(/value=["']IOS/);
    expect(source).not.toMatch(/platform:\s*['"]IOS['"]/);
    expect(source).toMatch(/platform:\s*['"]ANDROID['"]/);
  });

  it('the device-limit denial still routes to the increase-devices flow', () => {
    const source = readFileSync(resolve(SRC, 'pages/family/devices/AddDeviceWizard.tsx'), 'utf8');
    expect(source).toContain('MANAGED_DEVICE_LIMIT_REACHED');
    expect(source).toContain('/subscription/increase-devices');
  });
});

describe('VIEW_DEVICE_ENROLLMENT gate scope (regression: re-sectioning must not shrink it)', () => {
  // A string-presence assertion cannot catch a gate that still EXISTS but now wraps
  // less than it did. This pins the two sections whose outer gate was lost when the
  // single long device page became six tabs: Add device and Pending setup. The server
  // independently enforces CREATE_INVITATION and LIST_OWN_INVITATIONS, so the client
  // gate is defence in depth -- which is exactly the kind of protection that erodes
  // quietly if nothing asserts it.
  it('gates both the Add-device and Pending-setup sections, not only protection/advanced', () => {
    const source = readFileSync(resolve(SRC, 'pages/family/devices/DevicesTabs.tsx'), 'utf8');
    for (const section of ['AddDeviceWizard', 'PendingSetupSection']) {
      const index = source.indexOf(`<${section}`);
      expect(index, `${section} must be rendered by DevicesTabs`).toBeGreaterThan(-1);
      const before = source.slice(0, index);
      const openGate = before.lastIndexOf('<PermissionGate action="VIEW_DEVICE_ENROLLMENT">');
      const closeGate = before.lastIndexOf('</PermissionGate>');
      expect(
        openGate > closeGate,
        `${section} must render INSIDE a VIEW_DEVICE_ENROLLMENT gate`,
      ).toBe(true);
    }
  });

  // The source-scan above cannot tell a gate that renders `null` from one
  // that silently renders its children anyway (a wiring mistake, a typo'd
  // action string, PermissionGate itself regressing) -- so this actually
  // renders the page as a role denied VIEW_DEVICE_ENROLLMENT (CHILD; see
  // src/domain/roles.ts's VIEW_DEVICE_ENROLLMENT case) and asserts the real
  // DOM, not source positions.
  //
  // Deliberately does NOT seed a child first: CHILD is ALSO denied
  // CREATE_DEVICE_INVITATION (AddDeviceWizard's own INNER PermissionGate),
  // so a populated wizard body would stay hidden by that inner gate alone
  // and this test would pass even with the OUTER VIEW_DEVICE_ENROLLMENT gate
  // removed -- a false negative confirmed by actually removing the outer
  // gate and watching this exact test keep passing with a seeded child.
  // Branch C ("Add your first child", the empty-registry state) sits
  // ABOVE/OUTSIDE that inner gate entirely, so an empty registry is the one
  // case that isolates the outer gate's own contribution.
  it('a role denied VIEW_DEVICE_ENROLLMENT sees neither section render any content, on real rendered DOM', async () => {
    __resetDevDeviceEnrollmentState();
    __resetDevChildProfileState();
    __resetChildLabelsForTest();

    renderWithProviders(<Devices />, { role: 'CHILD', route: '/family/devices?section=add' });
    await screen.findByRole('heading', { name: 'Devices' });
    // Nothing from AddDeviceWizard's step-0 gate (loading/error/"Add your
    // first child") ever appears -- the whole subtree is gone, not merely
    // disabled. Waits out the transient familyId-resolution window (see
    // tests/component/AddChildFlow.test.tsx's header) before asserting.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(screen.queryByText('Add your first child')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Someone new' })).toBeNull();

    renderWithProviders(<Devices />, { role: 'CHILD', route: '/family/devices?section=pending' });
    await screen.findAllByRole('heading', { name: 'Devices' });
    expect(screen.queryByRole('heading', { name: 'Invitations' })).toBeNull();
  });
});
