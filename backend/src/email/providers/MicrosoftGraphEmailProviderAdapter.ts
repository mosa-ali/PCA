import { randomUUID } from 'node:crypto';
import type { EmailProviderAdapter, EmailSendResult, RenderedEmailMessage } from '../EmailProviderAdapter.js';
import { EmailDeliveryError } from '../EmailProviderAdapter.js';

export interface MicrosoftGraphAdapterConfig {
  readonly tenantId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** The mailbox this app sends as -- Graph's `/users/{senderUserId}/sendMail`, requiring app-only Mail.Send permission granted (admin-consented) for this specific mailbox. */
  readonly senderUserId: string;
  readonly fromName: string;
  readonly replyToAddress?: string;
}

const TOKEN_ENDPOINT_TEMPLATE = 'https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token';
const GRAPH_SEND_MAIL_TEMPLATE = 'https://graph.microsoft.com/v1.0/users/{senderUserId}/sendMail';
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
// Refresh 60s before the token's own reported expiry -- a request that starts
// just before expiry must not race a token that goes stale mid-flight.
const TOKEN_EXPIRY_SAFETY_MARGIN_MS = 60_000;

interface CachedToken {
  accessToken: string;
  expiresAtEpochMillis: number;
}

/**
 * PCA-DW-W2-15D -- Microsoft Graph `sendMail` transport, OAuth2
 * client-credentials (app-only) flow. Built entirely on Node's built-in
 * `fetch` -- no MSAL/Graph SDK dependency; token acquisition is a single
 * URL-encoded POST, well within what's reasonable to implement directly
 * rather than take on a new dependency for.
 *
 * PRODUCTION_PROVIDER_CONFIGURED status: this adapter is CODE_READY (built,
 * unit-testable against a stubbed fetch) but NOT ACTIVE -- pcasafe.com's
 * current mail setup is plain DNS forwarding aliases to an external
 * mailbox, not a verified Microsoft 365 tenant (see
 * docs/public/reports/RELEASE_A_CONTACT_CHANNEL_VERIFICATION.md), and no
 * tenant/app-registration credentials exist yet. Selecting this adapter
 * (PCA_EMAIL_PROVIDER=MICROSOFT_GRAPH) requires the owner to actually stand
 * up an M365 tenant + app registration with admin-consented Mail.Send
 * first.
 */
export class MicrosoftGraphEmailProviderAdapter implements EmailProviderAdapter {
  readonly providerName = 'MICROSOFT_GRAPH';
  private cachedToken: CachedToken | null = null;

  constructor(
    private readonly config: MicrosoftGraphAdapterConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAtEpochMillis > this.now()) {
      return this.cachedToken.accessToken;
    }
    const tokenUrl = TOKEN_ENDPOINT_TEMPLATE.replace('{tenantId}', encodeURIComponent(this.config.tenantId));
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: GRAPH_SCOPE,
    });
    const response = await this.fetchImpl(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!response.ok) {
      const retryable = response.status >= 500 || response.status === 429;
      throw new EmailDeliveryError(`Microsoft Graph token request failed with HTTP ${response.status}`, retryable);
    }
    const payload = (await response.json()) as { access_token?: string; expires_in?: number };
    if (typeof payload.access_token !== 'string' || typeof payload.expires_in !== 'number') {
      throw new EmailDeliveryError('Microsoft Graph token response missing access_token/expires_in', false);
    }
    this.cachedToken = {
      accessToken: payload.access_token,
      expiresAtEpochMillis: this.now() + payload.expires_in * 1000 - TOKEN_EXPIRY_SAFETY_MARGIN_MS,
    };
    return this.cachedToken.accessToken;
  }

  async send(message: RenderedEmailMessage): Promise<EmailSendResult> {
    const accessToken = await this.getAccessToken();
    const sendUrl = GRAPH_SEND_MAIL_TEMPLATE.replace('{senderUserId}', encodeURIComponent(this.config.senderUserId));
    // Graph's sendMail has no message-id echo in a normal 202 response body,
    // so a caller-generated id is what EmailOutboxProcessor records as this
    // send's providerMessageId (still unique per attempt, still useful for
    // correlating a specific delivery attempt in redacted audit output).
    const clientRequestId = randomUUID();
    const response = await this.fetchImpl(sendUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        'client-request-id': clientRequestId,
      },
      body: JSON.stringify({
        message: {
          subject: message.subject,
          body: { contentType: 'HTML', content: message.html },
          toRecipients: [{ emailAddress: { address: message.toEmail } }],
          replyTo: this.config.replyToAddress ? [{ emailAddress: { address: this.config.replyToAddress } }] : undefined,
          from: { emailAddress: { address: this.config.senderUserId, name: this.config.fromName } },
        },
        saveToSentItems: false,
      }),
    });
    if (response.status === 202) {
      return { providerMessageId: clientRequestId };
    }
    const retryable = response.status >= 500 || response.status === 429;
    throw new EmailDeliveryError(`Microsoft Graph sendMail failed with HTTP ${response.status}`, retryable);
  }
}
