import { beforeEach, describe, expect, it } from 'vitest';
import { DevBillingClient, __resetDevBillingStateForTests, simulateAdminApproveParentMemberRequest, simulateAdminDeny, simulateAdminIssueCustomQuote, simulateServerPaymentConfirmation } from '../../src/api/dev/devBillingClient';

describe('DevBillingClient -- entitlement state machine (PCA-MYKIDS-BILL-1)', () => {
  let client: DevBillingClient;

  beforeEach(() => {
    __resetDevBillingStateForTests();
    client = new DevBillingClient();
  });

  it('every new family starts on FREE_STARTER: 1 parent member, 1 managed device, both used', async () => {
    const entitlement = await client.getEntitlement();
    expect(entitlement.tier).toBe('FREE_STARTER');
    expect(entitlement.parentMemberLimit).toBe(1);
    expect(entitlement.managedDeviceLimit).toBe(1);
    expect(entitlement.managedDeviceActive).toBe(1);
    expect(entitlement.managedDeviceReserved).toBe(0);
    expect(entitlement.availableDeviceSlots).toBe(0);
    expect(entitlement.overLimitManagedDevice).toBe(false);

    const subscription = await client.getSubscription();
    expect(subscription.status).toBe('FREE_STARTER');
  });

  it('rejects a target at or below the current limit', async () => {
    await expect(client.requestLimitIncrease('MANAGED_DEVICE_LIMIT', 1)).rejects.toThrow(/greater than the current limit/);
    await expect(client.requestLimitIncrease('MANAGED_DEVICE_LIMIT', 0)).rejects.toThrow();
  });

  it('resolves a standard priced quote automatically for a seeded target quantity (PENDING -> QUOTED, no admin step)', async () => {
    const request = await client.requestLimitIncrease('MANAGED_DEVICE_LIMIT', 2);
    expect(request.state).toBe('QUOTED');
    expect(request.awaitingAdminQuote).toBe(false);
    expect(request.quote?.quoteKind).toBe('STANDARD');
    expect(request.quote?.price.currencyCode).toBe('USD');
    expect(BigInt(request.quote?.price.amountMinor ?? '0') > 0n).toBe(true);
  });

  it('marks a request PENDING_ADMIN_QUOTE (awaitingAdminQuote) when no standard price exists for the requested quantity', async () => {
    const request = await client.requestLimitIncrease('MANAGED_DEVICE_LIMIT', 4);
    expect(request.state).toBe('PENDING');
    expect(request.awaitingAdminQuote).toBe(true);
    expect(request.quote).toBeNull();
  });

  it('a PARENT_MEMBER_LIMIT request never resolves a quote and never becomes billable (PCA-ADD-PA-054)', async () => {
    const request = await client.requestLimitIncrease('PARENT_MEMBER_LIMIT', 2);
    expect(request.state).toBe('PENDING');
    expect(request.awaitingAdminQuote).toBe(false);
    expect(request.quote).toBeNull();
  });

  it('an open request appears in the entitlement snapshot pendingRequestSummary-equivalent openRequests list', async () => {
    const request = await client.requestLimitIncrease('MANAGED_DEVICE_LIMIT', 2);
    const entitlement = await client.getEntitlement();
    expect(entitlement.openRequests.map((r) => r.requestId)).toContain(request.requestId);
  });

  it('cancelRequest succeeds from PENDING or QUOTED but not from PAYMENT_PENDING', async () => {
    const quoted = await client.requestLimitIncrease('MANAGED_DEVICE_LIMIT', 2);
    const cancelled = await client.cancelRequest(quoted.requestId);
    expect(cancelled.state).toBe('CANCELLED');

    const another = await client.requestLimitIncrease('MANAGED_DEVICE_LIMIT', 3);
    await client.beginCheckout(another.requestId);
    await expect(client.cancelRequest(another.requestId)).rejects.toThrow(/PENDING or QUOTED/);
  });

  it('beginCheckout moves QUOTED -> PAYMENT_PENDING and never itself raises the device limit or marks APPROVED', async () => {
    const quoted = await client.requestLimitIncrease('MANAGED_DEVICE_LIMIT', 2);
    const pending = await client.beginCheckout(quoted.requestId);
    expect(pending.state).toBe('PAYMENT_PENDING');

    const entitlement = await client.getEntitlement();
    expect(entitlement.managedDeviceLimit).toBe(1); // unchanged -- only server confirmation may raise it
  });

  it('beginCheckout refuses a request that is not QUOTED', async () => {
    const pending = await client.requestLimitIncrease('MANAGED_DEVICE_LIMIT', 4); // awaiting admin quote, not QUOTED
    await expect(client.beginCheckout(pending.requestId)).rejects.toThrow(/QUOTED/);
  });

  it('server-side payment confirmation raises the device limit, approves the request, and creates a paid invoice', async () => {
    const quoted = await client.requestLimitIncrease('MANAGED_DEVICE_LIMIT', 3);
    await client.beginCheckout(quoted.requestId);

    const confirmed = await simulateServerPaymentConfirmation(quoted.requestId);
    expect(confirmed.state).toBe('APPROVED');

    const entitlement = await client.getEntitlement();
    expect(entitlement.managedDeviceLimit).toBe(3);

    const invoices = await client.listInvoices();
    expect(invoices).toHaveLength(1);
    expect(invoices[0].status).toBe('PAID');
    expect(invoices[0].lines[0].lineType).toBe('DEVICE_LIMIT_INCREASE');
  });

  it('a duplicate confirmation for an already-approved request is an idempotent no-op (does not double-apply)', async () => {
    const quoted = await client.requestLimitIncrease('MANAGED_DEVICE_LIMIT', 2);
    await client.beginCheckout(quoted.requestId);
    await simulateServerPaymentConfirmation(quoted.requestId);
    await simulateServerPaymentConfirmation(quoted.requestId); // duplicate "webhook redelivery" / UI refresh

    const entitlement = await client.getEntitlement();
    expect(entitlement.managedDeviceLimit).toBe(2); // not double-raised
    const invoices = await client.listInvoices();
    expect(invoices).toHaveLength(1); // not double-invoiced
  });

  it('an admin-issued custom quote moves an awaiting-quote request to QUOTED and unblocks checkout', async () => {
    const awaiting = await client.requestLimitIncrease('MANAGED_DEVICE_LIMIT', 4);
    const quoted = await simulateAdminIssueCustomQuote(awaiting.requestId);
    expect(quoted.state).toBe('QUOTED');
    expect(quoted.awaitingAdminQuote).toBe(false);
    expect(quoted.quote?.quoteKind).toBe('CUSTOM');

    const pending = await client.beginCheckout(quoted.requestId);
    expect(pending.state).toBe('PAYMENT_PENDING');
  });

  it('a parent-member request can be approved directly at no charge, without ever entering QUOTED', async () => {
    const request = await client.requestLimitIncrease('PARENT_MEMBER_LIMIT', 2);
    const approved = await simulateAdminApproveParentMemberRequest(request.requestId);
    expect(approved.state).toBe('APPROVED');

    const entitlement = await client.getEntitlement();
    expect(entitlement.parentMemberLimit).toBe(2);
  });

  it('a denied request records a reason and is not left ambiguous', async () => {
    const request = await client.requestLimitIncrease('MANAGED_DEVICE_LIMIT', 4);
    const denied = await simulateAdminDeny(request.requestId, 'Requires manual pricing review beyond policy limit.');
    expect(denied.state).toBe('DENIED');
    expect(denied.denialReason).toBe('Requires manual pricing review beyond policy limit.');
  });

  it('isPaymentProviderAvailable is true in dev fixtures', () => {
    expect(client.isPaymentProviderAvailable()).toBe(true);
  });
});
