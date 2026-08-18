import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Waits for the "Create invitation" button to become enabled (the dev
 * session's familyId resolves asynchronously after AuthProvider's fixture
 * delay) before clicking it.
 */
export async function clickCreateInvitation(): Promise<void> {
  const button = await screen.findByRole('button', { name: 'Create invitation' });
  await waitFor(() => expect(button).not.toBeDisabled());
  await userEvent.click(button);
  await userEvent.click(await screen.findByRole('button', { name: 'I understand, create invitation' }));
}
