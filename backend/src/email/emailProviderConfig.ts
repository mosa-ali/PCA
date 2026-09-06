import { isProductionSensitiveRuntime } from '../runtime/environment.js';
import type { EmailProviderAdapter } from './EmailProviderAdapter.js';
import { RejectingEmailProviderAdapter } from './providers/RejectingEmailProviderAdapter.js';
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

function resolveSenderIdentity(env: NodeJS.ProcessEnv): EmailSenderIdentity {
  return {
    fromAddress: requireEnv(env, 'PCA_EMAIL_FROM_ADDRESS'),
    fromName: env.PCA_EMAIL_FROM_NAME && env.PCA_EMAIL_FROM_NAME.length > 0 ? env.PCA_EMAIL_FROM_NAME : 'PCA',
    replyToAddress: env.PCA_EMAIL_REPLY_TO_ADDRESS && env.PCA_EMAIL_REPLY_TO_ADDRESS.length > 0 ? env.PCA_EMAIL_REPLY_TO_ADDRESS : undefined,
  };
}

function createSmtpAdapter(env: NodeJS.ProcessEnv, identity: EmailSenderIdentity): SmtpEmailProviderAdapter {
  const host = requireEnv(env, 'PCA_SMTP_HOST');
  const portRaw = requireEnv(env, 'PCA_SMTP_PORT');
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new EmailProviderConfigError(`PCA_SMTP_PORT must be a valid TCP port number, got ${JSON.stringify(portRaw)}.`);
  }
  const secure = env.PCA_SMTP_SECURE === 'true';
  return new SmtpEmailProviderAdapter({
    host,
    port,
    secure,
    username: env.PCA_SMTP_USERNAME,
    password: env.PCA_SMTP_PASSWORD,
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
    fromName: identity.fromName,
    replyToAddress: identity.replyToAddress,
  });
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
