import type { EmailProviderAdapter } from './EmailProviderAdapter.js';

export interface EmailServiceHealth {
  readonly providerConfigured: boolean;
  readonly providerName: string;
}

/** No network call -- reports whether a real provider adapter is wired at all, never delivery success (an actual send is exercised by the outbox worker, not a health probe). */
export function getEmailServiceHealth(providerAdapter: Pick<EmailProviderAdapter, 'providerName'>): EmailServiceHealth {
  return {
    providerConfigured: providerAdapter.providerName !== 'REJECTING_NO_PROVIDER_CONFIGURED',
    providerName: providerAdapter.providerName,
  };
}
