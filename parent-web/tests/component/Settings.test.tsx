// B082/B084 (product-completion ledger): Settings.tsx's single field floated
// directly under the page h1 with no grouping, unlike every other page in
// this app (Subscription.tsx, RolesMatrix.tsx, ...) which groups related
// content under a card + its own heading. This proves the language control
// now lives inside such a card/section, giving the page real heading
// hierarchy (h1 page title -> h2 section title) instead of a flat h1+field.
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import Settings from '../../src/pages/Settings';
import { renderWithProviders } from '../utils/renderWithProviders';

describe('Settings page structure (B082/B084)', () => {
  it('groups the language control under its own card section with a heading distinct from the page title', async () => {
    renderWithProviders(<Settings />);
    const pageTitle = await screen.findByRole('heading', { level: 1, name: 'Settings' });
    const sectionTitle = screen.getByRole('heading', { level: 2, name: 'Language preferences' });
    expect(sectionTitle).toBeInTheDocument();
    expect(sectionTitle).not.toBe(pageTitle);

    const card = sectionTitle.closest('.card');
    expect(card).not.toBeNull();
    expect(card!.querySelector('#lang-select')).not.toBeNull();
  });
});
