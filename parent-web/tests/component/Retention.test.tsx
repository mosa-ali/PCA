import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../utils/renderWithProviders';
import Retention from '../../src/pages/privacy/Retention';
import { __devLastSubmittedRetentionPolicy } from '../../src/api/dev/devRetentionClient';

describe('Retention', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('submits a separately bounded location-history window through the real policy shape', async () => {
    renderWithProviders(<Retention />, { role: 'OWNER' });

    const locationRadio = await screen.findByRole('radio', { name: 'Location history: 14 days' });
    expect(locationRadio).not.toBeDisabled();
    await userEvent.click(locationRadio);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Re-authenticate (dev stub)' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Retention policy validated and audited');
    expect(__devLastSubmittedRetentionPolicy()?.locationMode).toEqual({ window: '14_DAYS' });
  });

  it('disables location windows longer than the selected general retention window', async () => {
    renderWithProviders(<Retention />, { role: 'OWNER' });

    const general14Days = await screen.findByRole('radio', { name: /^14 days$/ });
    await userEvent.click(general14Days);
    expect(screen.getByRole('radio', { name: 'Location history: 1 month' })).toBeDisabled();
  });
});
