/**
 * PCA-BILL-2A -- TEST_SANDBOX payment provider adapter. Implements
 * providerContract.ts's `PaymentProvider` interface with an entirely
 * in-process, in-memory simulated payment gateway -- no network call, no
 * real money movement, no production credential of any kind.
 *
 * PRODUCTION GATE: this file's class (`TestSandboxPaymentProvider`) is a
 * plain constructor with no gate of its own -- the gate lives in the
 * factory function `createSandboxPaymentProvider` below, which is the ONLY
 * sanctioned construction path (providerRegistry.ts's bootstrap calls
 * exclusively through this factory, never `new TestSandboxPaymentProvider`
 * directly). The factory throws `SandboxProviderProductionGateError` unless
 * NODE_ENV is exactly 'test' or 'development'.
 *
 * SIGNATURE VERIFICATION: a real HMAC-SHA256 check over the raw request
 * body bytes against a `SecretResolver`-provided test secret, using a
 * constant-time comparison (`crypto.timingSafeEqual`) -- never a
 * "signature header present" or substring check.
 *
 * ENVELOPE FORMAT (sandbox-specific, not a real provider's wire format):
 * `{ eventId, eventKind, providerPaymentRef, timestamp }` as JSON. The
 * `timestamp` field is what webhook.ts's freshness/replay check reads.
 */

import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import type {
  CreateCheckoutInput,
  CreateCheckoutResult,
  PaymentProvider,
  QueryPaymentResult,
  RefundResult,
  VerifyWebhookInput,
  VerifyWebhookResult,
} from '../providerContract.js';
import type { SecretResolver } from './secretResolver.js';
import { SANDBOX_ONLY_SECRET_REF } from './secretResolver.js';

export const TEST_SANDBOX_PROVIDER_NAME = 'TEST_SANDBOX';

export type SandboxPaymentStatus = 'PENDING' | 'CONFIRMED' | 'FAILED' | 'CANCELLED';

interface SandboxPaymentState {
  providerPaymentRef: string;
  paymentAttemptId: string;
  amountMinor: bigint;
  currencyCode: string;
  status: SandboxPaymentStatus;
  createdAt: Date;
  refunds: Array<{ providerRefundRef: string; amountMinor: bigint; status: 'PENDING' | 'CONFIRMED' | 'FAILED' }>;
}

export class SandboxProviderProductionGateError extends Error {
  constructor() {
    super('TEST_SANDBOX provider may only be constructed when NODE_ENV is "test" or "development".');
    this.name = 'SandboxProviderProductionGateError';
  }
}

export class SandboxPaymentNotFoundError extends Error {
  constructor(providerPaymentRef: string) {
    super(`No sandbox payment state found for providerPaymentRef: ${providerPaymentRef}`);
    this.name = 'SandboxPaymentNotFoundError';
  }
}

export interface SandboxWebhookEnvelope {
  readonly eventId: string;
  readonly eventKind: string;
  readonly providerPaymentRef: string;
  readonly timestamp: string;
}

/**
 * A fully in-memory TEST_SANDBOX adapter. State does not survive a process
 * restart -- acceptable because this adapter itself is refused outside
 * test/development environments (see `createSandboxPaymentProvider`), so
 * "durable across restarts" was never a real requirement for it.
 */
export class TestSandboxPaymentProvider implements PaymentProvider {
  readonly providerName = TEST_SANDBOX_PROVIDER_NAME;
  private readonly payments = new Map<string, SandboxPaymentState>();

  constructor(private readonly secretResolver: SecretResolver) {}

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    const providerCheckoutRef = `sbx_chk_${randomUUID()}`;
    this.payments.set(providerCheckoutRef, {
      providerPaymentRef: providerCheckoutRef,
      paymentAttemptId: input.paymentAttemptId,
      amountMinor: input.amountMinor,
      currencyCode: input.currencyCode,
      status: 'PENDING',
      createdAt: new Date(),
      refunds: [],
    });
    return {
      providerCheckoutRef,
      // A JSON status endpoint, not a real UI -- see billingWebhookRoutes.ts's
      // sandbox status route. Never a redirect to any real payment page.
      redirectUrl: `/billing/sandbox/checkout/${providerCheckoutRef}`,
    };
  }

  async verifyWebhook(input: VerifyWebhookInput): Promise<VerifyWebhookResult> {
    const secret = await this.secretResolver.resolve(SANDBOX_ONLY_SECRET_REF);
    const expected = createHmac('sha256', secret).update(input.rawPayload).digest();
    let providedBuffer: Buffer;
    try {
      providedBuffer = Buffer.from(input.signatureHeader, 'hex');
    } catch {
      return { verified: false };
    }
    // timingSafeEqual throws on length mismatch -- treat that identically
    // to "does not match", never as a distinguishable error.
    if (providedBuffer.length !== expected.length || !timingSafeEqual(providedBuffer, expected)) {
      return { verified: false };
    }

    let envelope: Partial<SandboxWebhookEnvelope>;
    try {
      envelope = JSON.parse(input.rawPayload.toString('utf8')) as Partial<SandboxWebhookEnvelope>;
    } catch {
      return { verified: false };
    }
    if (typeof envelope.eventId !== 'string' || envelope.eventId.length === 0) return { verified: false };
    return {
      verified: true,
      providerEventId: envelope.eventId,
      eventKind: typeof envelope.eventKind === 'string' ? envelope.eventKind : undefined,
    };
  }

  async queryPayment(providerPaymentRef: string): Promise<QueryPaymentResult> {
    const state = this.payments.get(providerPaymentRef);
    if (!state) throw new SandboxPaymentNotFoundError(providerPaymentRef);
    return {
      providerPaymentRef: state.providerPaymentRef,
      status: state.status,
      amountMinor: state.amountMinor,
      currencyCode: state.currencyCode,
    };
  }

  async refund(providerPaymentRef: string, amountMinor: bigint, _reason: string): Promise<RefundResult> {
    const state = this.payments.get(providerPaymentRef);
    if (!state) throw new SandboxPaymentNotFoundError(providerPaymentRef);
    if (state.status !== 'CONFIRMED') {
      const providerRefundRef = `sbx_rfnd_${randomUUID()}`;
      state.refunds.push({ providerRefundRef, amountMinor, status: 'FAILED' });
      return { providerRefundRef, status: 'FAILED' };
    }
    const providerRefundRef = `sbx_rfnd_${randomUUID()}`;
    state.refunds.push({ providerRefundRef, amountMinor, status: 'CONFIRMED' });
    return { providerRefundRef, status: 'CONFIRMED' };
  }

  // ---------------------------------------------------------------------
  // Test-only simulation helpers (NOT part of the PaymentProvider
  // interface -- never called from production business logic, only from
  // test harnesses and this adapter's own sandbox status route).
  // ---------------------------------------------------------------------

  /** Signs a raw payload with the sandbox test secret -- the exact signature a valid webhook delivery would carry. */
  async signPayload(rawPayload: Buffer): Promise<string> {
    const secret = await this.secretResolver.resolve(SANDBOX_ONLY_SECRET_REF);
    return createHmac('sha256', secret).update(rawPayload).digest('hex');
  }

  /** Builds a well-formed sandbox webhook envelope Buffer for a given payment ref -- test harnesses use this plus signPayload to construct a full valid delivery. */
  buildEnvelope(providerPaymentRef: string, eventKind: string, timestamp: Date = new Date(), eventId: string = randomUUID()): Buffer {
    const envelope: SandboxWebhookEnvelope = { eventId, eventKind, providerPaymentRef, timestamp: timestamp.toISOString() };
    return Buffer.from(JSON.stringify(envelope), 'utf8');
  }

  simulateConfirm(providerPaymentRef: string, overrides?: { amountMinor?: bigint; currencyCode?: string }): void {
    const state = this.getStateForTest(providerPaymentRef);
    state.status = 'CONFIRMED';
    if (overrides?.amountMinor !== undefined) state.amountMinor = overrides.amountMinor;
    if (overrides?.currencyCode !== undefined) state.currencyCode = overrides.currencyCode;
  }

  simulateFail(providerPaymentRef: string): void {
    this.getStateForTest(providerPaymentRef).status = 'FAILED';
  }

  simulateCancel(providerPaymentRef: string): void {
    this.getStateForTest(providerPaymentRef).status = 'CANCELLED';
  }

  getStatusForTest(providerPaymentRef: string): SandboxPaymentStatus {
    return this.getStateForTest(providerPaymentRef).status;
  }

  private getStateForTest(providerPaymentRef: string): SandboxPaymentState {
    const state = this.payments.get(providerPaymentRef);
    if (!state) throw new SandboxPaymentNotFoundError(providerPaymentRef);
    return state;
  }
}

/**
 * The ONLY sanctioned construction path for TestSandboxPaymentProvider.
 * Refuses (throws SandboxProviderProductionGateError) unless NODE_ENV is
 * exactly 'test' or 'development' -- providerRegistry.ts's
 * createDefaultProviderRegistry is the sole production-facing caller, and
 * it only calls this when its own identical env gate already passed
 * (belt-and-suspenders: two independent checks must both agree before a
 * sandbox provider is ever registered).
 */
export function createSandboxPaymentProvider(secretResolver: SecretResolver, env: NodeJS.ProcessEnv = process.env): TestSandboxPaymentProvider {
  const nodeEnv = env.NODE_ENV;
  if (nodeEnv !== 'test' && nodeEnv !== 'development') {
    throw new SandboxProviderProductionGateError();
  }
  return new TestSandboxPaymentProvider(secretResolver);
}
