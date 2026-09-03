import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Walks the guided Add-device wizard from step 1 to the setup code.
 *
 * Creating an invitation is no longer one click plus a modal: it is
 * child -> device type -> protection -> review + monitoring-scope consent ->
 * the code. Each "next" button is labelled with the step it leads to, which is
 * what these queries use.
 *
 * The caller must have rendered the Devices page on `?section=add`.
 */
export async function runAddDeviceWizard(): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: 'What kind of device?' }));
  await userEvent.click(await screen.findByRole('button', { name: 'How much protection?' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Review and confirm' }));
  await clickCreateInvitation();
}

/**
 * Confirms the monitoring scope on the review step, which is the click that
 * actually creates the invitation. The button is disabled until the fixture
 * session's familyId resolves.
 */
export async function clickCreateInvitation(): Promise<void> {
  const confirm = await screen.findByRole('button', { name: 'I understand, create invitation' });
  await waitFor(() => expect(confirm).not.toBeDisabled());
  await userEvent.click(confirm);
}

/** Switches to one of the six device sections by clicking its tab. */
export async function openDeviceSection(tabName: string): Promise<void> {
  await userEvent.click(await screen.findByRole('tab', { name: tabName }));
}
