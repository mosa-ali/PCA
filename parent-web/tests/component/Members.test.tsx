import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../utils/renderWithProviders';
import Members from '../../src/pages/family/Members';
import { __resetDevFamilyMemberInvitationsForTests } from '../../src/api/dev/devFamilyMemberInvitationClient';

/**
 * ADD_VIEWER/ADD_ADMINISTRATOR/REMOVE_NON_OWNER_PARENT/CHANGE_ANY_ROLE are
 * all in useFamilyAction's STEP_UP_ACTIONS set (see domain/roles.ts), so
 * every mutating action on this page pops the dev step-up dialog -- confirm
 * it, mirroring tests/route/familyActions.test.tsx's established pattern.
 */
async function confirmStepUp() {
  // The step-up confirm button's label lost its '(dev stub)' developer marker
  // when that copy was made production-honest; StepUpProvider is mounted
  // app-wide with no fixture gate, so real users were reading it.
  await userEvent.click(await screen.findByRole('button', { name: 'Re-authenticate' }));
}

async function sendInvite(email: string) {
  const emailInput = await screen.findByLabelText('Email address');
  await userEvent.clear(emailInput);
  await userEvent.type(emailInput, email);
  await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
  await confirmStepUp();
}

// TEST TIMING: the three tests below each drive the full step-up modal
// (open -> confirm -> re-issue the guarded action) through userEvent, which
// reproducibly exceeds vitest's default 5000ms testTimeout on a loaded
// machine -- they pass on a quiet one and fail on a busy one, with the
// failure always reported as "Test timed out", never as a failed assertion.
// Same environment characteristic, and same remedy, as
// platform-admin-web/tests/unit/Dashboard.test.tsx's rollup waitFor timeout
// (commit 601690a). No assertion is weakened; only the clock is.
const STEP_UP_FLOW_TIMEOUT_MS = 20_000;

describe('Members', () => {
  beforeEach(() => {
    __resetDevFamilyMemberInvitationsForTests();
  });

  it('sending a second invitation while one is already pending surfaces a clear, translated conflict message -- never the raw client diagnostic string', async () => {
    renderWithProviders(<Members />, { role: 'OWNER' });
    await sendInvite('first@example.com');
    await screen.findByText('Pending');

    await sendInvite('second@example.com');

    expect(
      await screen.findByText('A pending invitation already exists for this person. Revoke it first before sending a new one.'),
    ).toBeInTheDocument();
    // Never the raw diagnostic string a FamilyMemberInvitationClient implementation throws internally.
    expect(screen.queryByText(/FamilyMemberInvitationClient\.invite/)).not.toBeInTheDocument();
    expect(screen.queryByText(/duplicate_pending_invitation/)).not.toBeInTheDocument();
  }, STEP_UP_FLOW_TIMEOUT_MS);

  it('revoking a pending invitation transitions its status and removes its action controls', async () => {
    renderWithProviders(<Members />, { role: 'OWNER' });
    await sendInvite('member@example.com');
    await screen.findByText('Pending');

    await userEvent.click(screen.getByRole('button', { name: 'Revoke invitation' }));
    await confirmStepUp();

    await waitFor(() => expect(screen.getByText('Revoked')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Revoke invitation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Change to/ })).not.toBeInTheDocument();
  }, STEP_UP_FLOW_TIMEOUT_MS);

  it('changing an invitation role updates the displayed role while it is still pending', async () => {
    renderWithProviders(<Members />, { role: 'OWNER' });
    await sendInvite('member@example.com');
    await screen.findByText('Pending');

    expect(screen.getByRole('button', { name: 'Change to Administrator' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Change to Administrator' }));
    await confirmStepUp();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Change to Viewer' })).toBeInTheDocument());
  }, STEP_UP_FLOW_TIMEOUT_MS);

  it('never renders the raw "No recovery secrets..." notice as a translation-key path -- always the real EN copy', async () => {
    renderWithProviders(<Members />, { role: 'OWNER' });
    expect(await screen.findByText('No recovery secrets, keys, or tokens are ever shown on this page.')).toBeInTheDocument();
  });

  it('shows the member-removal safety notice, separate from Delete Now', async () => {
    renderWithProviders(<Members />, { role: 'OWNER' });
    expect(
      await screen.findByText("Removing a non-owner parent ends that member's family access. It is separate from removing a child device and from Delete Now."),
    ).toBeInTheDocument();
  });

  it('a Viewer cannot see the invite-a-member form (client-side UX gate; the real gate is server-side)', async () => {
    renderWithProviders(<Members />, { role: 'VIEWER' });
    await screen.findByText('Active members');
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument();
    // Every REMOVE_NON_OWNER_PARENT/ADD_VIEWER PermissionGate on this page renders
    // this same disabled-fallback badge for a Viewer -- assert at least one exists
    // rather than assuming exactly one (the fixture seeds several non-owner members).
    expect(screen.getAllByText('Not permitted for your role').length).toBeGreaterThan(0);
  });
});
