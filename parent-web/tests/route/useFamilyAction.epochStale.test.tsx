import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useFamilyAction } from '../../src/rbac/useFamilyAction';
import { renderWithProviders } from '../utils/renderWithProviders';
import { getApiClients } from '../../src/api/client';

function ActionButton({ label, run }: { label: string; run: () => Promise<unknown> }) {
  const runFamilyAction = useFamilyAction();
  const [result, setResult] = useState<string>('idle');
  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          try {
            await runFamilyAction('EDIT_CHILD_POLICY', run);
            setResult('success');
          } catch (e) {
            setResult(e instanceof Error ? e.message : 'error');
          }
        }}
      >
        {label}
      </button>
      <p data-testid="result">{result}</p>
    </div>
  );
}

describe('useFamilyAction trusted-browser epoch gating', () => {
  it('blocks a sensitive mutation while the trusted browser is EPOCH_STALE, even for an Owner', async () => {
    const clients = getApiClients();
    await clients.trustedBrowser.reset();
    await clients.trustedBrowser.beginServiceAuthentication();
    await clients.trustedBrowser.requestPairing();
    await clients.trustedBrowser.simulateParentApproval();
    await clients.trustedBrowser.simulateEpochGoneStale();

    const run = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<ActionButton label="Edit policy" run={run} />, { role: 'OWNER' });
    await userEvent.click(screen.getByText('Edit policy'));
    await waitFor(() => expect(screen.getByTestId('result')).not.toHaveTextContent('idle'));
    expect(screen.getByTestId('result')).toHaveTextContent(/EPOCH_STALE/);
    expect(run).not.toHaveBeenCalled();

    // Cleanup shared dev singleton state so it doesn't leak into other test files.
    await clients.trustedBrowser.reset();
  });

  it('blocks a sensitive mutation while the trusted browser is REVOKED', async () => {
    const clients = getApiClients();
    await clients.trustedBrowser.reset();
    await clients.trustedBrowser.beginServiceAuthentication();
    await clients.trustedBrowser.requestPairing();
    await clients.trustedBrowser.simulateParentApproval();
    await clients.trustedBrowser.simulateRevoke();

    const run = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<ActionButton label="Edit policy" run={run} />, { role: 'OWNER' });
    await userEvent.click(screen.getByText('Edit policy'));
    await waitFor(() => expect(screen.getByTestId('result')).not.toHaveTextContent('idle'));
    expect(screen.getByTestId('result')).toHaveTextContent(/REVOKED/);
    expect(run).not.toHaveBeenCalled();

    await clients.trustedBrowser.reset();
  });

  it('allows the mutation once trust converges back to TRUSTED', async () => {
    const clients = getApiClients();
    await clients.trustedBrowser.reset();
    await clients.trustedBrowser.beginServiceAuthentication();
    await clients.trustedBrowser.requestPairing();
    await clients.trustedBrowser.simulateParentApproval();

    const run = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<ActionButton label="Edit policy" run={run} />, { role: 'OWNER' });
    await userEvent.click(screen.getByText('Edit policy'));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('result')).toHaveTextContent('success');

    await clients.trustedBrowser.reset();
  });
});
