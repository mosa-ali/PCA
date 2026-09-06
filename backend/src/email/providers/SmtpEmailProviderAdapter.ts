import nodemailer from 'nodemailer';
import type { EmailProviderAdapter, EmailProviderErrorCategory, EmailSendResult, RenderedEmailMessage } from '../EmailProviderAdapter.js';
import { EmailDeliveryError } from '../EmailProviderAdapter.js';
import { EMAIL_PROVIDER_TIMEOUT_MS } from '../emailTimingPolicy.js';

export interface SmtpAdapterConfig {
  readonly host: string;
  readonly port: number;
  /** true = implicit TLS from connection start (typically port 465). false = plaintext connection that MUST upgrade via STARTTLS before any message is sent -- see this adapter's own doc comment on why `requireTLS` is always forced on in that case. */
  readonly secure: boolean;
  readonly username?: string;
  readonly password?: string;
  readonly fromAddress: string;
  readonly fromName: string;
  readonly replyToAddress?: string;
}

export interface SmtpErrorShape {
  code?: string;
  responseCode?: number;
  message?: string;
}

/**
 * SMTP 5xx and a handful of named client-side codes are permanent --
 * retrying them wastes the whole backoff/dead-letter budget on something
 * that can never succeed. Anything else (including an unrecognized shape)
 * is treated as transient, the safer default given EMAIL_MAX_ATTEMPTS still
 * bounds it. Exported for direct unit testing -- constructing a real SMTP
 * server response for every one of these codes just to exercise this
 * classification would be disproportionate.
 */
export function isSmtpErrorRetryable(err: SmtpErrorShape): boolean {
  if (typeof err.responseCode === 'number' && err.responseCode >= 500) return false;
  if (err.code === 'EAUTH' || err.code === 'EENVELOPE') return false;
  return true;
}

/** PCA-DW-W2-R1-8: a bounded, safe category for this SmtpErrorShape -- never the raw provider message, which may contain recipient/envelope/host detail. Exported for direct unit testing, same rationale as isSmtpErrorRetryable. */
export function classifySmtpErrorCategory(err: SmtpErrorShape): EmailProviderErrorCategory {
  if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') return 'EMAIL_PROVIDER_TIMEOUT';
  if (err.code === 'EAUTH') return 'EMAIL_PROVIDER_AUTH_FAILED';
  if (err.code === 'ECONNECTION' || err.code === 'ESOCKET' || err.code === 'EDNS') return 'EMAIL_PROVIDER_NETWORK';
  if (typeof err.responseCode === 'number') {
    if (err.responseCode === 421 || err.responseCode === 450 || err.responseCode === 451 || err.responseCode === 452 || err.responseCode === 454) {
      return 'EMAIL_PROVIDER_RATE_LIMITED';
    }
    if (err.responseCode >= 500) return 'EMAIL_PROVIDER_REJECTED';
  }
  if (err.code === 'EENVELOPE') return 'EMAIL_PROVIDER_REJECTED';
  return 'EMAIL_PROVIDER_UNKNOWN';
}

/**
 * PCA-DW-W2-15F -- generic SMTP transport via `nodemailer` (zero runtime
 * dependencies of its own; verified via `npm view nodemailer dependencies`
 * before adding it -- this codebase's dependency list stays deliberately
 * short). Works with essentially any provider that speaks standard SMTP
 * AUTH over TLS/STARTTLS, including Microsoft 365's own SMTP endpoint --
 * this is the adapter to use when the owner has NOT specifically chosen
 * Microsoft Graph (see MicrosoftGraphEmailProviderAdapter.ts for that
 * narrower, M365-specific path).
 *
 * PCA-DW-W2-R1-7: encrypted transport is MANDATORY, never opportunistic.
 * When `secure` is false (the STARTTLS port-587-style path), `requireTLS:
 * true` forces nodemailer to abort the send rather than fall back to
 * plaintext if the server does not (or claims not to) support STARTTLS --
 * without this, nodemailer's default behaviour silently sends a
 * verification/reset code, or the SMTP AUTH credential itself, over an
 * unencrypted connection whenever the peer doesn't advertise STARTTLS.
 * `tls.rejectUnauthorized` is always true -- this codebase has no
 * configuration path that can disable certificate verification.
 *
 * PCA-DW-W2-R1-6: every network phase (connect/greeting/socket) is bounded
 * by EMAIL_PROVIDER_TIMEOUT_MS -- see emailTimingPolicy.ts for why this
 * must stay well under the outbox claim lease.
 */
export class SmtpEmailProviderAdapter implements EmailProviderAdapter {
  readonly providerName = 'SMTP';
  private readonly transporter: ReturnType<typeof nodemailer.createTransport>;

  constructor(private readonly config: SmtpAdapterConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: !config.secure,
      tls: { rejectUnauthorized: true },
      connectionTimeout: EMAIL_PROVIDER_TIMEOUT_MS,
      greetingTimeout: EMAIL_PROVIDER_TIMEOUT_MS,
      socketTimeout: EMAIL_PROVIDER_TIMEOUT_MS,
      auth: config.username ? { user: config.username, pass: config.password } : undefined,
    });
  }

  async send(message: RenderedEmailMessage): Promise<EmailSendResult> {
    try {
      const info = await this.transporter.sendMail({
        from: `"${this.config.fromName}" <${this.config.fromAddress}>`,
        to: message.toEmail,
        replyTo: this.config.replyToAddress,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      return { providerMessageId: info.messageId };
    } catch (error) {
      const shape = error as SmtpErrorShape;
      throw new EmailDeliveryError(
        `SMTP send failed: ${shape.message ?? 'unknown error'}`,
        isSmtpErrorRetryable(shape),
        classifySmtpErrorCategory(shape),
        { cause: error },
      );
    }
  }
}
