import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../utils/renderWithProviders';
import Retention from '../../src/pages/privacy/Retention';
import Export from '../../src/pages/privacy/Export';
import DeleteNow from '../../src/pages/privacy/DeleteNow';

describe('Privacy pages render their authored disclosure copy', () => {
  it('Retention shows the local-enforcement and audit-retention notices', async () => {
    renderWithProviders(<Retention />, { role: 'OWNER' });
    expect(await screen.findByText(/Each device enforces retention against the local copy it holds/)).toBeInTheDocument();
    expect(screen.getByText(/Audit and tamper records have a separate floor/)).toBeInTheDocument();
  });

  it('Export shows the scope and external-copy notices', async () => {
    renderWithProviders(<Export />, { role: 'OWNER' });
    expect(await screen.findByText(/The export is limited to the authorized family data/)).toBeInTheDocument();
    expect(screen.getByText(/Once an encrypted export is saved outside PCA-managed storage/)).toBeInTheDocument();
  });

  it('DeleteNow shows all four consequence disclosures inside the confirm dialog, before confirming', async () => {
    renderWithProviders(<DeleteNow />, { role: 'OWNER' });
    await userEvent.click(screen.getByRole('button', { name: 'Delete Now' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Delete Now removes activity content only.');
    expect(dialog).toHaveTextContent('A child device that stays offline cannot be reported as erased.');
    expect(dialog).toHaveTextContent('Delete Now does not erase encrypted exports or backups outside PCA-managed storage.');
    expect(dialog).toHaveTextContent('PCA does not promise forensic-grade physical erasure on flash storage.');
  });

  it('DeleteNow surfaces the real returned deletion plan (queued/retained counts) after confirming, not a fabricated "done"', async () => {
    renderWithProviders(<DeleteNow />, { role: 'OWNER' });
    await userEvent.click(screen.getByRole('button', { name: 'Delete Now' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Re-authenticate' }));

    expect(await screen.findByText('2 item(s) queued for deletion; 1 retained under a longer floor (e.g. audit records).')).toBeInTheDocument();
  });
});
