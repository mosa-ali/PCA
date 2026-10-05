import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultSensitiveOperation, useFamilyAction } from '../../src/rbac/useFamilyAction';
import { getApiClients } from '../../src/api/client';
import type { FamilyAction } from '../../src/domain/roles';
import { renderWithProviders } from '../utils/renderWithProviders';

function ActionButton({ label, run, action = 'CHANGE_ANY_ROLE' }: { label: string; run: () => Promise<unknown>; action?: FamilyAction }) {
  const runFamilyAction = useFamilyAction();
  const [result, setResult] = useState<string>('idle');
  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          try {
            await runFamilyAction(action, run);
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
  it('maps administrator invitations to the backend family.member.add operation', () => {
    expect(defaultSensitiveOperation('ADD_ADMINISTRATOR')).toBe('family.member.add');
    expect(defaultSensitiveOperation('CHANGE_ANY_ROLE')).toBe('family.member.role_change');
  });

  it('rejects a Viewer attempting a role-change action even if invoked directly (not just hidden)', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<ActionButton label="Change role" run={run} />, { role: 'VIEWER' });
    await userEvent.click(screen.getByText('Change role'));
    await waitFor(() => expect(screen.getByTestId('result')).not.toHaveTextContent('idle'));
    expect(screen.getByTestId('result')).toHaveTextContent(/Administrator/i);
    expect(run).not.toHaveBeenCalled();
  });

  it('consults the current session gateway before running an otherwise allowed action', async () => {
    const checkPermission = vi.spyOn(getApiClients().familyAuthority, 'checkPermission').mockResolvedValue({ allowed: true, requiresStepUp: false });
    const run = vi.fn().mockResolvedValue(undefined);
    try {
      renderWithProviders(<ActionButton label="Edit policy" action="EDIT_CHILD_POLICY" run={run} />, { role: 'OWNER' });
      await userEvent.click(screen.getByText('Edit policy'));
      await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
      expect(checkPermission).toHaveBeenCalledExactlyOnceWith('EDIT_CHILD_POLICY');
      expect(screen.getByTestId('result')).toHaveTextContent('success');
    } finally {
      checkPermission.mockRestore();
    }
  });

  it('does not open step-up or run when the session gateway denies permission', async () => {
    const checkPermission = vi.spyOn(getApiClients().familyAuthority, 'checkPermission').mockResolvedValue({ allowed: false, reason: 'Current membership revoked.' });
    const run = vi.fn().mockResolvedValue(undefined);
    try {
      renderWithProviders(<ActionButton label="Change role" run={run} />, { role: 'OWNER' });
      await userEvent.click(screen.getByText('Change role'));
      await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('Current membership revoked.'));
      expect(checkPermission).toHaveBeenCalledExactlyOnceWith('CHANGE_ANY_ROLE');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(run).not.toHaveBeenCalled();
    } finally {
      checkPermission.mockRestore();
    }
  });

  it('fails closed before step-up or run when the session gateway is unavailable', async () => {
    const checkPermission = vi.spyOn(getApiClients().familyAuthority, 'checkPermission').mockRejectedValue(new Error('network failure'));
    const run = vi.fn().mockResolvedValue(undefined);
    try {
      renderWithProviders(<ActionButton label="Change role" run={run} />, { role: 'OWNER' });
      await userEvent.click(screen.getByText('Change role'));
      await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('Parent family authority is unavailable.'));
      expect(checkPermission).toHaveBeenCalledExactlyOnceWith('CHANGE_ANY_ROLE');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(run).not.toHaveBeenCalled();
    } finally {
      checkPermission.mockRestore();
    }
  });

  it('requires step-up before an Administrator performs normal role administration', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<ActionButton label="Change role" run={run} />, { role: 'ADMINISTRATOR' });
    await userEvent.click(screen.getByText('Change role'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
  });

  it('requires a fresh authenticator code before an Owner performs a sensitive action', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<ActionButton label="Change role" run={run} />, { role: 'OWNER' });
    await userEvent.click(screen.getByText('Change role'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('6-digit authenticator code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm change' }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('result')).toHaveTextContent('success');
  });
});
