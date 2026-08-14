import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StepUpProvider, useStepUp } from '../../src/state/StepUpContext';
import { secureSession } from '../../src/security/secureSession';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function TriggerButton() {
  const { requestStepUp } = useStepUp();
  return (
    <button
      type="button"
      onClick={async () => {
        const stepUpId = await requestStepUp('REFUND');
        document.title = stepUpId ?? 'CANCELLED';
      }}
    >
      trigger
    </button>
  );
}

describe('StepUpContext', () => {
  beforeEach(() => {
    secureSession.set('tok-1', new Date(Date.now() + 60_000).toISOString());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('never assumes login MFA satisfies step-up: always re-prompts for a fresh code', async () => {
    render(
      <StepUpProvider>
        <TriggerButton />
      </StepUpProvider>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'trigger' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/authenticator code/i)).toHaveValue('');
  });

  it('cancelling resolves the pending promise with null and closes the dialog', async () => {
    render(
      <StepUpProvider>
        <TriggerButton />
      </StepUpProvider>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'trigger' }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.title).toBe('CANCELLED');
  });

  it('a valid code resolves with the server-issued stepUpId', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { stepUpId: 'su-42', expiresAt: '2030-01-01T00:00:00Z' })));
    render(
      <StepUpProvider>
        <TriggerButton />
      </StepUpProvider>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'trigger' }));
    await user.type(screen.getByLabelText(/authenticator code/i), '111222');
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    await screen.findByText(/trigger/i); // dialog closed, trigger button visible again
    expect(document.title).toBe('su-42');
  });

  it('an invalid code shows an error and keeps the dialog open', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(403, { error: 'forbidden' })));
    render(
      <StepUpProvider>
        <TriggerButton />
      </StepUpProvider>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'trigger' }));
    await user.type(screen.getByLabelText(/authenticator code/i), '999999');
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not accepted/i);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
