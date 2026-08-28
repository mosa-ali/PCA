import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useFamilyAction } from '../../src/rbac/useFamilyAction';
import { renderWithProviders } from '../utils/renderWithProviders';

function ActionButton({ label, run }: { label: string; run: () => Promise<unknown> }) {
  const runFamilyAction = useFamilyAction();
  const [result, setResult] = useState<string>('idle');
  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          try {
            await runFamilyAction('CHANGE_ANY_ROLE', run);
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

describe('useFamilyAction gateway enforcement', () => {
  it('rejects a Viewer attempting a role-change action even if invoked directly (not just hidden)', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<ActionButton label="Change role" run={run} />, { role: 'VIEWER' });
    await userEvent.click(screen.getByText('Change role'));
    await waitFor(() => expect(screen.getByTestId('result')).not.toHaveTextContent('idle'));
    expect(screen.getByTestId('result')).toHaveTextContent(/Owner/i);
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects an Administrator attempting a restricted role-change action', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<ActionButton label="Change role" run={run} />, { role: 'ADMINISTRATOR' });
    await userEvent.click(screen.getByText('Change role'));
    await waitFor(() => expect(screen.getByTestId('result')).not.toHaveTextContent('idle'));
    expect(run).not.toHaveBeenCalled();
  });

  it('triggers the step-up dialog for an Owner performing a sensitive action, and only proceeds after confirming', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<ActionButton label="Change role" run={run} />, { role: 'OWNER' });
    await userEvent.click(screen.getByText('Change role'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText('Re-authenticate'));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('result')).toHaveTextContent('success');
  });
});
