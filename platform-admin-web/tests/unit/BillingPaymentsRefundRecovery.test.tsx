import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import BillingPayments from '../../src/pages/billing/BillingPayments';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { ToastProvider } from '../../src/state/ToastContext';
import { secureSession } from '../../src/security/secureSession';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const transactions = {
  items: [
    {
      paymentTransactionId: 'transaction-1',
      paymentAttemptId: 'attempt-1',
      accountRef: 'family-1',
      amount: { amountMinor: '1000', currencyCode: 'USD' },
      provider: 'TEST_SANDBOX',
      providerTransactionRef: 'provider-transaction-1',
      confirmedAt: '2026-10-01T00:00:00.000Z',
    },
  ],
  total: 1,
  limit: 20,
  offset: 0,
};

describe('BillingPayments refund finalization recovery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    secureSession.clear();
  });

  it('locks ambiguous refund inputs, then reuses the same key through finalization retries with fresh step-up', async () => {
    const refundCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
    let stepUpCount = 0;
    let refundCallCount = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof URL ? input : new URL(input.toString(), window.location.origin);
        const method = init?.method ?? 'GET';

        if (url.pathname === '/platform-admin/auth/whoami') {
          return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['APP_OWNER'] }));
        }
        if (url.pathname === '/platform-admin/billing/payment-attempts') {
          return Promise.resolve(jsonResponse(200, { items: [], total: 0, limit: 20, offset: 0 }));
        }
        if (url.pathname === '/platform-admin/billing/payment-transactions') {
          return Promise.resolve(jsonResponse(200, transactions));
        }
        if (url.pathname === '/platform-admin/billing/refund-recoveries') {
          return Promise.resolve(jsonResponse(200, { items: [], total: 0, limit: 20, offset: 0 }));
        }
        if (url.pathname === '/platform-admin/auth/step-up' && method === 'POST') {
          stepUpCount += 1;
          return Promise.resolve(jsonResponse(200, { stepUpId: `step-up-${stepUpCount}`, expiresAt: '2026-10-06T00:00:00.000Z' }));
        }
        if (url.pathname === '/billing/admin/refund' && method === 'POST') {
          refundCalls.push({ url: url.toString(), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
          refundCallCount += 1;
          if (refundCallCount === 1) {
            return Promise.resolve(jsonResponse(502, {
              error: 'provider_refund_failed',
              refundOperationId: 'refund-operation-1',
            }));
          }
          if (refundCallCount === 2) {
            return Promise.resolve(jsonResponse(202, {
              error: 'refund_pending_finalization',
              refundOperationId: 'refund-operation-1',
              providerRefundRef: 'provider-refund-1',
            }));
          }
          return Promise.resolve(jsonResponse(201, {
            refundId: 'refund-1',
            status: 'RECORDED',
            refundOperationId: 'refund-operation-1',
            providerRefundRef: 'provider-refund-1',
          }));
        }
        return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
      }),
    );

    secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/billing/payments']}>
          <ToastProvider>
            <AuthProvider>
              <StepUpProvider>
                <BillingPayments />
              </StepUpProvider>
            </AuthProvider>
          </ToastProvider>
        </MemoryRouter>
      </I18nextProvider>,
    );

    await user.click(await screen.findByRole('tab', { name: 'Payment transactions' }));
    const issueButton = await screen.findByRole('button', { name: 'Issue refund' });
    await user.type(screen.getByLabelText('Amount'), '3.50');
    await user.type(screen.getByLabelText('Reason code'), 'duplicate');
    await user.click(issueButton);
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    const pendingMessage = await screen.findByText(/result of this refund attempt could not be confirmed/i);
    expect(pendingMessage).toHaveTextContent('result of this refund attempt could not be confirmed');
    expect(pendingMessage).toHaveTextContent('refund-operation-1');
    expect(screen.getByLabelText('Amount')).toHaveValue('3.50');
    expect(screen.getByLabelText('Amount')).toBeDisabled();
    expect(screen.getByLabelText('Reason code')).toHaveValue('duplicate');
    expect(screen.getByLabelText('Reason code')).toBeDisabled();
    expect(screen.queryByText('Refund issued.')).not.toBeInTheDocument();
    expect(refundCalls).toHaveLength(1);

    // The operation state is owned by the page so changing tabs does not
    // discard the request key or turn a retry into a new refund.
    await user.click(screen.getByRole('tab', { name: 'Payment attempts' }));
    await user.click(screen.getByRole('tab', { name: 'Payment transactions' }));
    expect(await screen.findByRole('button', { name: 'Retry refund safely' })).toBeInTheDocument();
    expect(screen.getByLabelText('Amount')).toHaveValue('3.50');
    expect(screen.getByLabelText('Reason code')).toHaveValue('duplicate');

    await user.click(screen.getByRole('button', { name: 'Retry refund safely' }));
    await user.type(await screen.findByLabelText('Authenticator code'), '654321');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText(/provider confirmed this refund/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry recording refund' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry recording refund' }));
    await user.type(await screen.findByLabelText('Authenticator code'), '987654');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Refund issued.')).toBeInTheDocument();
    expect(refundCalls).toHaveLength(3);
    expect(new URL(refundCalls[0].url).pathname).toBe('/billing/admin/refund');
    expect(refundCalls[1].url).toBe(refundCalls[0].url);
    expect(refundCalls[2].url).toBe(refundCalls[0].url);
    expect(refundCalls[0].body).toMatchObject({
      paymentTransactionId: 'transaction-1',
      amountMinor: '350',
      currencyCode: 'USD',
      reasonCode: 'duplicate',
    });
    expect(refundCalls[1].body).toMatchObject({
      paymentTransactionId: 'transaction-1',
      amountMinor: '350',
      currencyCode: 'USD',
      reasonCode: 'duplicate',
      idempotencyKey: refundCalls[0].body.idempotencyKey,
    });
    expect(refundCalls[2].body).toMatchObject({
      paymentTransactionId: 'transaction-1',
      amountMinor: '350',
      currencyCode: 'USD',
      reasonCode: 'duplicate',
      idempotencyKey: refundCalls[0].body.idempotencyKey,
    });
    expect(refundCalls[0].body.idempotencyKey).toBeTruthy();
    expect(refundCalls[0].body.stepUpId).toBe('step-up-1');
    expect(refundCalls[1].body.stepUpId).toBe('step-up-2');
    expect(refundCalls[2].body.stepUpId).toBe('step-up-3');
    await waitFor(() => expect(
      screen.queryByText(/result of this refund attempt could not be confirmed|provider confirmed this refund/i),
    ).not.toBeInTheDocument());
  });

  it('recovers a server-listed operation after page reload and retries its exact key with fresh step-up', async () => {
    const refundCalls: Array<{ body: Record<string, unknown> }> = [];
    let stepUpCount = 0;
    let recoveries = [{
      refundOperationId: 'refund-operation-durable',
      paymentTransactionId: 'transaction-1',
      amountMinor: '350',
      currencyCode: 'USD',
      reasonCode: 'duplicate',
      idempotencyKey: 'durable-idempotency-key',
      state: 'PROVIDER_CONFIRMED',
      createdAt: '2026-10-05T00:00:00.000Z',
      updatedAt: '2026-10-05T00:01:00.000Z',
    }];

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof URL ? input : new URL(input.toString(), window.location.origin);
        const method = init?.method ?? 'GET';
        if (url.pathname === '/platform-admin/auth/whoami') {
          return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['APP_OWNER'] }));
        }
        if (url.pathname === '/platform-admin/billing/payment-attempts') {
          return Promise.resolve(jsonResponse(200, { items: [], total: 0, limit: 20, offset: 0 }));
        }
        if (url.pathname === '/platform-admin/billing/refund-recoveries') {
          return Promise.resolve(jsonResponse(200, { items: recoveries, total: recoveries.length, limit: 20, offset: 0 }));
        }
        if (url.pathname === '/platform-admin/auth/step-up' && method === 'POST') {
          stepUpCount += 1;
          return Promise.resolve(jsonResponse(200, { stepUpId: `recovery-step-up-${stepUpCount}`, expiresAt: '2026-10-06T00:00:00.000Z' }));
        }
        if (url.pathname === '/billing/admin/refund' && method === 'POST') {
          refundCalls.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> });
          recoveries = [];
          return Promise.resolve(jsonResponse(201, {
            refundId: 'refund-finalized',
            status: 'RECORDED',
            refundOperationId: 'refund-operation-durable',
          }));
        }
        return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
      }),
    );

    secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/billing/payments']}>
          <ToastProvider>
            <AuthProvider>
              <StepUpProvider>
                <BillingPayments />
              </StepUpProvider>
            </AuthProvider>
          </ToastProvider>
        </MemoryRouter>
      </I18nextProvider>,
    );

    expect(await screen.findByText('refund-operation-durable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry recording refund' }));
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Refund issued.')).toBeInTheDocument();
    expect(refundCalls).toHaveLength(1);
    expect(refundCalls[0].body).toMatchObject({
      paymentTransactionId: 'transaction-1',
      amountMinor: '350',
      currencyCode: 'USD',
      reasonCode: 'duplicate',
      idempotencyKey: 'durable-idempotency-key',
      stepUpId: 'recovery-step-up-1',
    });
    await waitFor(() => expect(screen.queryByText('refund-operation-durable')).not.toBeInTheDocument());
  });
});
