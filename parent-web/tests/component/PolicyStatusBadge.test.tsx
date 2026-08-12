import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { render } from '@testing-library/react';
import i18n from '../../src/i18n';
import { PolicyStatusBadge } from '../../src/components/common/PolicyStatusBadge';

describe('PolicyStatusBadge', () => {
  it('never renders the APPLIED label for a pending status', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <PolicyStatusBadge status="PENDING_DELIVERY" />
      </I18nextProvider>,
    );
    expect(screen.getByText(/Queued -- pending delivery/)).toBeInTheDocument();
    expect(screen.queryByText('Applied on device')).not.toBeInTheDocument();
  });

  it('renders the honest APPLIED label only when the status truly is APPLIED', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <PolicyStatusBadge status="APPLIED" />
      </I18nextProvider>,
    );
    expect(screen.getByText('Applied on device')).toBeInTheDocument();
  });
});
