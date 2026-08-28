// End-to-end for the useAsync -> ErrorState path: a data-load failure now
// reaches the parent as localized, user-appropriate copy instead of the raw
// `err.message`. Requests is used because it renders `<ErrorState message={error} />`
// straight from useAsync, exactly the shape every page in this app uses.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import i18n, { applyDocumentDirection } from '../../src/i18n';
import Requests from '../../src/pages/Requests';
import { renderWithProviders } from '../utils/renderWithProviders';
import { getApiClients } from '../../src/api/client';
import { ServiceUnavailableError } from '../../src/api/unavailable';
import { EndpointNotTrustedError } from '../../src/api/familyDataAccessErrors';

describe('data-load errors are shown as localized user copy, not developer prose', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it('replaces the "no real (non-fixture) backend implementation yet" message with honest user copy', async () => {
    const failure = new ServiceUnavailableError('RequestClient.listRequests');
    vi.spyOn(getApiClients().requests, 'listRequests').mockRejectedValue(failure);

    renderWithProviders(<Requests />, { role: 'OWNER' });

    expect(await screen.findByText(i18n.t('errors.serviceUnavailable'))).toBeInTheDocument();
    expect(screen.queryByText(/no real \(non-fixture\) backend implementation/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/src\/api\/client\.ts/)).not.toBeInTheDocument();
    expect(screen.queryByText(/RequestClient\.listRequests/)).not.toBeInTheDocument();
  });

  it('replaces the "requires a TRUSTED browser endpoint" message and localizes it into Arabic', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    const failure = new EndpointNotTrustedError('BROWSER_NOT_TRUSTED', 'RequestClient.listRequests');
    vi.spyOn(getApiClients().requests, 'listRequests').mockRejectedValue(failure);

    renderWithProviders(<Requests />, { role: 'OWNER' });

    expect(await screen.findByText(i18n.t('errors.endpointNotTrusted'))).toBeInTheDocument();
    expect(screen.queryByText(/BROWSER_NOT_TRUSTED/)).not.toBeInTheDocument();
    expect(screen.queryByText(/requires a TRUSTED browser endpoint/)).not.toBeInTheDocument();
  });

  it('falls back to the localized generic sentence for an unrecognised error (the old "Unknown error" literal)', async () => {
    vi.spyOn(getApiClients().requests, 'listRequests').mockRejectedValue(
      new Error('ECONNREFUSED 127.0.0.1:8080'),
    );

    renderWithProviders(<Requests />, { role: 'OWNER' });

    expect(await screen.findByText(i18n.t('errors.unknown'))).toBeInTheDocument();
    expect(screen.queryByText(/ECONNREFUSED/)).not.toBeInTheDocument();
    expect(screen.queryByText('Unknown error')).not.toBeInTheDocument();
  });
});
