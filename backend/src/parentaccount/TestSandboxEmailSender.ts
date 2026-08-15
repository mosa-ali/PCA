import type { EmailSenderPort } from './EmailSenderPort.js';

export class SandboxEmailSenderProductionGateError extends Error {
  constructor() {
    super('TEST_SANDBOX email sender may only be constructed when NODE_ENV is "test" or "development".');
    this.name = 'SandboxEmailSenderProductionGateError';
  }
}

export interface SentTestEmail {
  email: string;
  code: string;
  sentAt: Date;
}

/**
 * TEST_SANDBOX-style deliverable-to-logs/test-harness email sender
 * (PCA-ADD-IDENT-005, matching the existing payment-provider TEST_SANDBOX
 * precedent -- billing/provider/sandboxProvider.ts). Never sends a real
 * network request; records every "sent" email in-memory (for tests/E2E to
 * read the code back out of) and logs a redacted line (never the raw code)
 * to stdout. Real provider selection remains EXTERNAL_GATE, unchanged.
 *
 * Gated identically to TestSandboxPaymentProvider: only constructible via
 * `createTestSandboxEmailSender`, which throws unless NODE_ENV is exactly
 * 'test' or 'development'.
 */
export class TestSandboxEmailSender implements EmailSenderPort {
  private readonly sent: SentTestEmail[] = [];

  async sendVerificationCode(email: string, code: string): Promise<void> {
    this.sent.push({ email, code, sentAt: new Date() });
    // eslint-disable-next-line no-console -- TEST_SANDBOX-only, never runs in production (see createTestSandboxEmailSender's gate)
    console.log(`[TEST_SANDBOX email] verification code sent (email redacted, code redacted, length=${code.length})`);
  }

  /** TEST/E2E-only accessor -- reads back the most recently "sent" code for a given email, exactly as a real test harness would read a mailbox. */
  lastCodeFor(email: string): string | null {
    const normalized = email.trim().toLowerCase();
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      if (this.sent[i].email.trim().toLowerCase() === normalized) return this.sent[i].code;
    }
    return null;
  }
}

export function createTestSandboxEmailSender(env: NodeJS.ProcessEnv = process.env): TestSandboxEmailSender {
  if (env.NODE_ENV !== 'test' && env.NODE_ENV !== 'development') {
    throw new SandboxEmailSenderProductionGateError();
  }
  return new TestSandboxEmailSender();
}
