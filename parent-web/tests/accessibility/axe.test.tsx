import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import Dashboard from '../../src/pages/Dashboard';
import RolesMatrix from '../../src/pages/family/RolesMatrix';
import { renderWithProviders } from '../utils/renderWithProviders';

describe('accessibility spot checks (axe)', () => {
  it('Dashboard has no critical axe violations', async () => {
    const { container } = renderWithProviders(<Dashboard />);
    // allow initial fixture fetch to settle
    await new Promise((r) => setTimeout(r, 250));
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('Roles & permissions matrix has no critical axe violations', async () => {
    const { container } = renderWithProviders(<RolesMatrix />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
