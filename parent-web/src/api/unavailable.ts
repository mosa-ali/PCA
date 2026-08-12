// Explicit "not-ready" marker for API interfaces that have no real
// HTTP/relay-backed implementation yet in this repository slice (see
// ./client.ts KNOWN_BACKEND_INTEGRATION_ACTION notes). Providers built on
// top of this error are constructed ONLY when demo mode is off, and exist
// specifically so a genuinely-not-implemented interface surfaces an honest,
// typed UNAVAILABLE condition to the caller -- they must never fabricate
// fixture data and must never silently report success.
export type UnavailableReasonCode = 'NOT_IMPLEMENTED';

export class ServiceUnavailableError extends Error {
  readonly code: UnavailableReasonCode = 'NOT_IMPLEMENTED';

  constructor(interfaceName: string) {
    super(
      `${interfaceName} has no real (non-fixture) backend implementation yet in this repository slice. ` +
        'This is a genuine backend-integration gap, not a fixture fallback -- see KNOWN_BACKEND_INTEGRATION_ACTION ' +
        'notes in src/api/client.ts.',
    );
    this.name = 'ServiceUnavailableError';
  }
}
