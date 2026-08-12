// Typed errors for the trusted-browser-gated real family-data providers
// (src/api/real/realParentFamilyDataGateway.ts and siblings). Distinct from
// ServiceUnavailableError (src/api/unavailable.ts, which means "no backend
// implementation exists in this repository slice at all") and from
// CryptoReviewRequiredError (@pca/parent-sdk-browser-runtime, which means
// "the crypto suite itself isn't approved yet") -- EndpointNotTrustedError
// specifically means "this browser endpoint's trust state does not permit
// family-data access right now", which callers should be able to
// distinguish so the UI can point the parent at re-pairing rather than a
// generic error banner.
import type { TrustedBrowserState } from '../domain/trustedBrowser';

export class EndpointNotTrustedError extends Error {
  readonly code = 'ENDPOINT_NOT_TRUSTED' as const;
  readonly endpointState: TrustedBrowserState;

  constructor(endpointState: TrustedBrowserState, operation: string) {
    super(
      `${operation} requires a TRUSTED browser endpoint; current state is ${endpointState}. ` +
        'Service-login authentication alone is never sufficient to read or mutate family data.',
    );
    this.name = 'EndpointNotTrustedError';
    this.endpointState = endpointState;
  }
}
