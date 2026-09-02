// B067/B068 (product-completion ledger): RolesMatrix already listed a
// plain-language explanation per role, but a denied "—" cell gave no reason
// at all beyond "not permitted for your role", and the page had no legend
// explaining its own "—" / "(Step-up required)" symbols. This proves both
// additions: a legend row, and a per-cell tooltip/accessible-name carrying
// the SAME localized denial reason evaluatePermission already computes
// (never a hardcoded/invented explanation).
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../utils/renderWithProviders';
import RolesMatrix from '../../src/pages/family/RolesMatrix';
import en from '../../src/i18n/locales/en.json';

describe('RolesMatrix legend and per-cell denial reasons', () => {
  it('shows a legend explaining the "—" symbol and the step-up marker', async () => {
    renderWithProviders(<RolesMatrix />, { role: 'OWNER' });
    await screen.findByRole('table');
    expect(screen.getByText(en.rbac.legendDenied)).toBeInTheDocument();
    expect(screen.getByText(en.rbac.legendStepUp)).toBeInTheDocument();
  });

  it('a denied cell carries the specific denial reason as its tooltip and accessible name, not just a generic "denied"', async () => {
    renderWithProviders(<RolesMatrix />, { role: 'OWNER' });
    await screen.findByRole('table');
    const row = screen.getByText('Edit child policy').closest('tr')!;
    const cells = row.querySelectorAll('td');
    // ROLES order is OWNER, ADMINISTRATOR, VIEWER, CHILD -- a VIEWER is denied here.
    const viewerCell = cells[2].querySelector('span')!;
    expect(viewerCell.getAttribute('title')).toBe(en.rbac.denialReason.VIEWER_READ_ONLY_POLICY);
    expect(viewerCell.getAttribute('aria-label')).toContain(en.rbac.denialReason.VIEWER_READ_ONLY_POLICY);
  });
});
