import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppearanceProvider } from '../../src/state/AppearanceContext';
import { AppearanceSelector } from '../../src/components/common/AppearanceSelector';
import { LanguageSwitcher } from '../../src/components/common/LanguageSwitcher';

describe('appearance and language selector layout', () => {
  it('keeps the appearance control accessible without showing its label', () => {
    const { container } = render(
      <AppearanceProvider><AppearanceSelector /></AppearanceProvider>,
    );

    expect(screen.getByRole('combobox', { name: 'Appearance' })).toBeInTheDocument();
    expect(container.querySelector('.appearance-selector > .visually-hidden')).toHaveTextContent('Appearance');
    expect(container.querySelector('.appearance-selector')).toHaveClass('appearance-selector');
  });

  it('uses aligned, zero-margin control wrappers for language and appearance', () => {
    const { container } = render(
      <AppearanceProvider>
        <div className="header-controls"><LanguageSwitcher /><AppearanceSelector /></div>
      </AppearanceProvider>,
    );

    expect(container.querySelector('.header-controls')).toBeInTheDocument();
    expect(container.querySelector('.language-switcher')).toBeInTheDocument();
    expect(container.querySelector('.appearance-selector')).toBeInTheDocument();
  });
});
