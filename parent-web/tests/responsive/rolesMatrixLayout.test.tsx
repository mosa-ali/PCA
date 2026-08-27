import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../utils/renderWithProviders';
import RolesMatrix from '../../src/pages/family/RolesMatrix';

/**
 * jsdom does not perform real CSS layout, so -- matching this codebase's
 * existing responsive-test convention (see deviceEnrollmentLayout.test.tsx)
 * -- this assertion is structural: it confirms the responsive-cards class
 * and per-cell data-labels the actual CSS media query keys off of are
 * present, so this wide permission matrix collapses into stacked cards
 * instead of only horizontally scrolling at narrow viewports.
 */
describe('RolesMatrix narrow-width layout safety', () => {
  it('the permission matrix uses the responsive-cards/data-table classes shared with the rest of the app', async () => {
    renderWithProviders(<RolesMatrix />, { role: 'OWNER' });
    await screen.findByRole('table');

    const table = document.querySelector('table.data-table.responsive-cards');
    expect(table).not.toBeNull();
    const cell = table!.querySelector('td[data-label]');
    expect(cell).not.toBeNull();
    const rowHeader = table!.querySelector('th[scope="row"]');
    expect(rowHeader).not.toBeNull();
  });
});
