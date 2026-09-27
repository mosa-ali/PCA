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

describe('useFamilyAction does not depend on retired Parent browser authority', () => {
  it.each(['EPOCH_STALE', 'REVOKED'] as const)(
    'does not let %s browser state block an otherwise authorized family action',
    async (state) => {
      const clients = getApiClients();
      await clients.trustedBrowser.reset();
      await clients.trustedBrowser.beginServiceAuthentication();
      await clients.trustedBrowser.requestPairing();
      await clients.trustedBrowser.simulateParentApproval();
      if (state === 'EPOCH_STALE') await clients.trustedBrowser.simulateEpochGoneStale();
      else await clients.trustedBrowser.simulateRevoke();

      const getSnapshot = vi.spyOn(clients.trustedBrowser, 'getSnapshot');
      const run = vi.fn().mockResolvedValue(undefined);
      try {
        renderWithProviders(<ActionButton label="Edit policy" run={run} />, { role: 'OWNER' });
        await userEvent.click(screen.getByText('Edit policy'));
        await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
        expect(screen.getByTestId('result')).toHaveTextContent('success');
        expect(getSnapshot).not.toHaveBeenCalled();
      } finally {
        getSnapshot.mockRestore();
        await clients.trustedBrowser.reset();
      }
    },
  );
});
