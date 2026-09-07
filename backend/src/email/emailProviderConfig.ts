import { isProductionSensitiveRuntime } from '../runtime/environment.js';
import type { EmailProviderAdapter } from './EmailProviderAdapter.js';
import { RejectingEmailProviderAdapter } from './providers/RejectingEmailProviderAdapter.js';
import { resolveOutboxEncryptionKeyBytes } from './emailOutboxEncryption.js';
import { SmtpEmailProviderAdapter } from './providers/SmtpEmailProviderAdapter.js';
import { MicrosoftGraphEmailProviderAdapter } from './providers/MicrosoftGraphEmailProviderAdapter.js';

/**
 * PCA-DW-W2-15F -- production email provider selection + sender identity,
 * resolved entirely from environment configuration. FAILS CLOSED: in
 * production, PCA_EMAIL_PROVIDER must be exactly "SMTP" or
 * "MICROSOFT_GRAPH" with a COMPLETE configuration for that provider, or
 * this throws rather than silently returning a provider that will fail (or
 * worse, half-configured) every send. Outside production, an unselected
 * provider resolves to RejectingEmailProviderAdapter -- a safe, honestly-
 * failing default (main.ts never actually reaches this path in test/
 * development, where TestSandboxEmailSender is used instead; this default
 * exists so this module's own unit tests, and any direct EmailService
 * construction, behave sanely without a real provider configured).
 */
export class EmailProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailProviderConfigError';
  }
}

export interface EmailSenderIdentity {
  readonly fromAddress: string;
  readonly fromName: string;
  readonly replyToAddress?: string;
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new EmailProviderConfigError(`${name} is required when PCA_EMAIL_PROVIDER=${env.PCA_EMAIL_PROVIDER} is selected.`);
  }
  return value;
}

// Deliberately a basic sanity check, not full RFC 5322 validation -- its
// job is narrow: prove the configured value is EMAIL-shaped, not (for
// example) a bare Microsoft Graph object-id GUID accidentally reused as a
// sender address (PCA-DW-W2-R1-10).
const PLAUSIBLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function resolveSenderIdentity(env: NodeJS.ProcessEnv): EmailSenderIdentity {
  const fromAddress = requireEnv(env, 'PCA_EMAIL_FROM_ADDRESS');
  if (!PLAUSIBLE_EMAIL_PATTERN.test(fromAddress)) {
    throw new EmailProviderConfigError(`PCA_EMAIL_FROM_ADDRESS does not look like a valid email address: ${JSON.stringify(fromAddress)}.`);
  }
  if (env.PCA_EMAIL_REPLY_TO_ADDRESS && env.PCA_EMAIL_REPLY_TO_ADDRESS.length > 0 && !PLAUSIBLE_EMAIL_PATTERN.test(env.PCA_EMAIL_REPLY_TO_ADDRESS)) {
    throw new EmailProviderConfigError(`PCA_EMAIL_REPLY_TO_ADDRESS does not look like a valid email address: ${JSON.stringify(env.PCA_EMAIL_REPLY_TO_ADDRESS)}.`);
  }
  return {
    fromAddress,
    fromName: env.PCA_EMAIL_FROM_NAME && env.PCA_EMAIL_FROM_NAME.length > 0 ? env.PCA_EMAIL_FROM_NAME : 'PCA',
    replyToAddress: env.PCA_EMAIL_REPLY_TO_ADDRESS && env.PCA_EMAIL_REPLY_TO_ADDRESS.length > 0 ? env.PCA_EMAIL_REPLY_TO_ADDRESS : undefined,
  };
}

/** PCA-DW-W2-R1-7: PCA_SMTP_SECURE is a security-relevant switch (encrypted-from-the-start vs. requires-STARTTLS) -- it must never silently default to false for an unrecognized/misspelled value. Only the two exact literal strings are accepted. */
function resolveSmtpSecureFlag(env: NodeJS.ProcessEnv): boolean {
  const raw = env.PCA_SMTP_SECURE;
  if (raw !== 'true' && raw !== 'false') {
    throw new EmailProviderConfigError(`PCA_SMTP_SECURE must be exactly "true" or "false" (got ${JSON.stringify(raw)}) -- a typo must never silently mean false.`);
  }
  return raw === 'true';
}

function createSmtpAdapter(env: NodeJS.ProcessEnv, identity: EmailSenderIdentity): SmtpEmailProviderAdapter {
  const host = requireEnv(env, 'PCA_SMTP_HOST');
  const portRaw = requireEnv(env, 'PCA_SMTP_PORT');
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new EmailProviderConfigError(`PCA_SMTP_PORT must be a valid TCP port number, got ${JSON.stringify(portRaw)}.`);
  }
  const secure = resolveSmtpSecureFlag(env);
  const username = env.PCA_SMTP_USERNAME && env.PCA_SMTP_USERNAME.length > 0 ? env.PCA_SMTP_USERNAME : undefined;
  const password = env.PCA_SMTP_PASSWORD && env.PCA_SMTP_PASSWORD.length > 0 ? env.PCA_SMTP_PASSWORD : undefined;
  if ((username && !password) || (password && !username)) {
    throw new EmailProviderConfigError('PCA_SMTP_USERNAME and PCA_SMTP_PASSWORD must both be set, or both be unset -- one without the other is a configuration error, not an unauthenticated-SMTP intent.');
  }
  return new SmtpEmailProviderAdapter({
    host,
    port,
    secure,
    username,
    password,
    fromAddress: identity.fromAddress,
    fromName: identity.fromName,
    replyToAddress: identity.replyToAddress,
  });
}

function createMicrosoftGraphAdapter(env: NodeJS.ProcessEnv, identity: EmailSenderIdentity): MicrosoftGraphEmailProviderAdapter {
  return new MicrosoftGraphEmailProviderAdapter({
    tenantId: requireEnv(env, 'PCA_GRAPH_TENANT_ID'),
    clientId: requireEnv(env, 'PCA_GRAPH_CLIENT_ID'),
    clientSecret: requireEnv(env, 'PCA_GRAPH_CLIENT_SECRET'),
    senderUserId: requireEnv(env, 'PCA_GRAPH_SENDER_USER_ID'),
    // PCA-DW-W2-R1-10: NEVER senderUserId here -- that field is the Graph
    // URL-path mailbox identifier (UPN or GUID, either accepted), never
    // validated as an email address and not necessarily one. identity.fromAddress
    // is the one PCA_EMAIL_FROM_ADDRESS value resolveSenderIdentity already
    // validated is email-shaped, shared with the SMTP adapter.
    fromAddress: identity.fromAddress,
    fromName: identity.fromName,
    replyToAddress: identity.replyToAddress,
  });
}

/**
 * Startup assertion for the COMPLETE production email path, not just the
 * provider half of it.
 *
 * `resolveEmailProviderAdapter` already fails loudly at boot when a provider is
 * NAMED but its credentials are incomplete -- a genuine operator
 * misconfiguration worth surfacing immediately. The durable outbox's
 * encryption key (`PCA_EMAIL_OUTBOX_ENCRYPTION_KEY`) is equally required and
 * sits on exactly the same critical path, but was only ever resolved lazily at
 * the first send. That left a real production hole: with a provider fully
 * configured and this one key missing, the process booted, `/health` returned
 * ok, and `/health/email` returned `{"status":"ok","provider":"SMTP"}` --
 * while the very first real parent registration answered HTTP 500, created the
 * account row anyway, and enqueued NOTHING (the throw happens before the
 * outbox insert, so the durable-retry path never sees the message either).
 * Both health signals an operator would check before a production cutover
 * reported green over a completely non-functional authentication path.
 *
 * Resolving the key here makes that misconfiguration behave exactly like the
 * incomplete-credentials case it belongs with: refuse to start.
 *
 * Deliberately scoped to a SELECTED provider. With no provider configured at
 * all, the absence of an outbox key is not a misconfiguration -- it is the
 * honest not-yet-configured state `createEmailProviderAdapterForProduction`
 * documents, and it must keep booting so the rest of the product can run.
 */
export function assertProductionEmailConfigurationComplete(env: NodeJS.ProcessEnv = process.env): void {
  if (env.PCA_EMAIL_PROVIDER !== 'SMTP' && env.PCA_EMAIL_PROVIDER !== 'MICROSOFT_GRAPH') return;
  resolveOutboxEncryptionKeyBytes(env);
}

export function resolveEmailProviderAdapter(env: NodeJS.ProcessEnv = process.env): EmailProviderAdapter {
  const selection = env.PCA_EMAIL_PROVIDER;
  if (selection !== 'SMTP' && selection !== 'MICROSOFT_GRAPH') {
    if (isProductionSensitiveRuntime(env)) {
      throw new EmailProviderConfigError(
        `PCA_EMAIL_PROVIDER must be exactly "SMTP" or "MICROSOFT_GRAPH" in production (got ${JSON.stringify(selection)}).`,
      );
    }
    return new RejectingEmailProviderAdapter();
  }
  const identity = resolveSenderIdentity(env);
  return selection === 'SMTP' ? createSmtpAdapter(env, identity) : createMicrosoftGraphAdapter(env, identity);
}
