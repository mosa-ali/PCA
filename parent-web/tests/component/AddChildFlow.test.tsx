import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../utils/renderWithProviders';
import Devices from '../../src/pages/family/Devices';
import { getApiClients } from '../../src/api/client';
import { __resetDevDeviceEnrollmentState } from '../../src/api/dev/devDeviceEnrollmentClient';
import { __resetDevChildProfileState } from '../../src/api/dev/devChildProfileClient';
import { __resetChildLabelsForTest, getChildLabel } from '../../src/domain/childLabels';

/**
 * The owner-mandated new-family acceptance flow (docs/pre-production/
 * PCA_PPR2_OWNER_DECISIONS.md Part F/H2/H4): no child -> Add first child ->
 * local readable label -> child appears -> Add Device -> child selectable.
 *
 * PRIVACY-CRITICAL: this file's job is to prove the name NEVER reaches the
 * network layer -- not merely that the UI looks right. It spies on
 * clients.childProfiles.createChildProfile's actual call arguments, the
 * one place a leak would occur.
 */

/**
 * renderWithProviders mounts AuthProvider directly, without AppLayout's own
 * `if (loading) return null` gate (src/components/shell/AppLayout.tsx) --
 * real routing never lets a page read session.familyId before that gate
 * clears, so DevicesTabs.tsx's `session?.familyId ?? ''` is never actually
 * '' in production. Here it briefly is, and AddDeviceWizard's registry fetch
 * is keyed on it ([familyId] in its useAsync call): familyId resolving from
 * '' to real mid-test triggers a SECOND listChildProfiles fetch, which
 * transiently remounts the "Someone new" button (Loading -> gone -> back) as
 * a fresh DOM node. Awaiting the same two async calls the app's own
 * AuthProvider + AddDeviceWizard are already mid-flight on -- in the same
 * order -- guarantees both handoffs have landed before this test ever
 * queries for that button, so userEvent never grabs a reference to a node
 * that's about to be discarded. This matches what a real user, gated by
 * AppLayout, always sees: familyId is never '' by the time the page renders.
 */
async function settleAuth(clients: ReturnType<typeof getApiClients>): Promise<void> {
  const session = await clients.serviceAuth.getSession();
  await clients.childProfiles.listChildProfiles(session?.familyId ?? '');
}

describe('Add first child -- the new-family flow', () => {
  beforeEach(() => {
    __resetDevDeviceEnrollmentState();
    __resetDevChildProfileState();
    __resetChildLabelsForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a new family sees "Add your first child", never a disabled dropdown with no explanation', async () => {
    const clients = getApiClients();
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=add' });
    await settleAuth(clients);

    expect(await screen.findByRole('heading', { name: 'Add your first child' })).toBeInTheDocument();
    expect(screen.getByText('Give your child a name to start setting up their device.')).toBeInTheDocument();
    expect(screen.queryByText('No child profiles available')).toBeNull();
    expect(screen.queryByRole('combobox', { name: /child/i })).toBeNull();
  });

  it('create -> local label -> child appears -> selectable for Add Device, all in one session', async () => {
    const clients = getApiClients();
    const createSpy = vi.spyOn(clients.childProfiles, 'createChildProfile');

    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=add' });
    await settleAuth(clients);

    await userEvent.click(await screen.findByRole('button', { name: 'Someone new' }));
    const nameInput = await screen.findByLabelText("Child's name");
    await userEvent.type(nameInput, 'Ahmed');

    // The reassurance the name stays local is on screen while typing it.
    expect(screen.getByText('This name stays on your device. PCA never sends it to our servers.')).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: 'What kind of device?' }));

    // The wizard actually advanced -- proves createChildProfile resolved and
    // the id was accepted, not that the click was merely dispatched.
    expect(await screen.findByRole('heading', { level: 3, name: 'What kind of device?' })).toBeInTheDocument();

    // THE PRIVACY-CRITICAL ASSERTION: the network call carried no name.
    expect(createSpy).toHaveBeenCalledTimes(1);
    const [, input] = createSpy.mock.calls[0];
    expect(input ?? {}).not.toHaveProperty('displayName');
    expect(JSON.stringify(input ?? {})).not.toContain('Ahmed');

    // The label resolved from the CREATE call's real, server-minted id is
    // now in the session-local store -- not before the call, not guessed.
    const createdId = (await createSpy.mock.results[0].value).childProfileId;
    expect(getChildLabel(createdId)).toBe('Ahmed');

    // Advance to review and confirm the label renders there too, sourced
    // from the session store, not from wizard-local typed state.
    await userEvent.click(await screen.findByRole('button', { name: 'How much protection?' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Review and confirm' }));
    expect(screen.getByText('Ahmed', { selector: 'bdi' })).toBeInTheDocument();
  });

  it('the child list refreshes without a page reload after creation -- reload() is the mechanism, not a route change', async () => {
    const clients = getApiClients();
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=add' });
    await settleAuth(clients);

    await userEvent.click(await screen.findByRole('button', { name: 'Someone new' }));
    await userEvent.type(await screen.findByLabelText("Child's name"), 'Sara');
    await userEvent.click(await screen.findByRole('button', { name: 'What kind of device?' }));
    await screen.findByRole('heading', { level: 3, name: 'What kind of device?' });

    // Go back to step 0 -- the newly created child is now a REAL registry
    // entry (not just wizard-local state), so it appears as a selectable
    // radio option instead of the "add new" flow still being active.
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }));
    expect(await screen.findByLabelText('Sara')).toBeInTheDocument();
  });

  it('a create failure shows a real error and does NOT advance the wizard', async () => {
    const clients = getApiClients();
    vi.spyOn(clients.childProfiles, 'createChildProfile').mockRejectedValue(new Error('network down'));

    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=add' });
    await settleAuth(clients);
    await userEvent.click(await screen.findByRole('button', { name: 'Someone new' }));
    await userEvent.type(await screen.findByLabelText("Child's name"), 'Lina');
    await userEvent.click(await screen.findByRole('button', { name: 'What kind of device?' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    // Still on step 0 -- 'What kind of device?' is the NEXT-button label
    // here, not a step-3 heading, so its presence as a button (not a step
    // heading) confirms no advance happened.
    expect(screen.queryByRole('heading', { level: 3, name: 'What kind of device?' })).toBeNull();
  });

  it('the Next button is disabled while the create call is in flight, and its label reflects that', async () => {
    const clients = getApiClients();
    let resolveCreate: (value: { childProfileId: string; createdAt: string }) => void = () => {};
    vi.spyOn(clients.childProfiles, 'createChildProfile').mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );

    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=add' });
    await settleAuth(clients);
    await userEvent.click(await screen.findByRole('button', { name: 'Someone new' }));
    await userEvent.type(await screen.findByLabelText("Child's name"), 'Mohammed');

    const nextButton = screen.getByRole('button', { name: 'What kind of device?' });
    await userEvent.click(nextButton);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Adding child...' })).toBeDisabled());

    resolveCreate({ childProfileId: 'child-inflight-1', createdAt: new Date().toISOString() });
    await screen.findByRole('heading', { level: 3, name: 'What kind of device?' });
  });
});
