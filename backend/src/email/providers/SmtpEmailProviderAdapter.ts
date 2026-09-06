import nodemailer from 'nodemailer';
import type { EmailProviderAdapter, EmailSendResult, RenderedEmailMessage } from '../EmailProviderAdapter.js';
import { EmailDeliveryError } from '../EmailProviderAdapter.js';

export interface SmtpAdapterConfig {
  readonly host: string;
  readonly port: number;
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

/** SMTP 5xx and a handful of named client-side codes are permanent -- retrying them wastes the whole backoff/dead-letter budget on something that can never succeed. Anything else (including an unrecognized shape) is treated as transient, the safer default given EMAIL_MAX_ATTEMPTS still bounds it. Exported for direct unit testing -- constructing a real SMTP server response for every one of these codes just to exercise this classification would be disproportionate. */
export function isSmtpErrorRetryable(err: SmtpErrorShape): boolean {
  if (typeof err.responseCode === 'number' && err.responseCode >= 500) return false;
  if (err.code === 'EAUTH' || err.code === 'EENVELOPE') return false;
  return true;
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
 */
export class SmtpEmailProviderAdapter implements EmailProviderAdapter {
  readonly providerName = 'SMTP';
  private readonly transporter: ReturnType<typeof nodemailer.createTransport>;

  constructor(private readonly config: SmtpAdapterConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
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
      throw new EmailDeliveryError(`SMTP send failed: ${shape.message ?? 'unknown error'}`, isSmtpErrorRetryable(shape), { cause: error });
    }
  }
}
