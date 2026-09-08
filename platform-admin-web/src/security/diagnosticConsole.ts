/**
 * PCA-FINAL-ASSESSMENT 2026-09-08 (FABLE-A057, privacy sink): the single
 * console sink for developer diagnostics in this app.
 *
 * Why this exists: `useAsync`, `Settings` and the app error boundary used to
 * dump the RAW error object (and React component stack) to `console.error`.
 * A fetch/domain error object can carry a request URL, a family/child
 * identifier, a rejected domain rule or a whole response body -- and the
 * browser console is a sink the architecture's privacy-absence list
 * explicitly covers (doc 27; PCA-NFR-014 telemetry absence applies to any
 * log surface a support bundle could capture).
 *
 * Contract:
 *  - In a development build, the full raw value is logged (developers need it).
 *  - In a PRODUCTION build, only the fixed label and the bounded, string-typed
 *    diagnostic detail are logged. The raw object is NEVER passed through,
 *    so nothing structured can reach the console by accident.
 *
 * `detail` must already be a redacted, string-typed summary such as
 * `errorDiagnosticDetail(err)` (an error name + message), never JSON of a
 * response body. Tested by tests/unit/diagnosticConsole.test.ts (parent-web; platform-admin-web mirrors the helper verbatim) with a
 * synthetic sentinel.
 */
export function reportDiagnostic(label: string, detail: string, raw?: unknown): void {
  if (import.meta.env.PROD) {
    // eslint-disable-next-line no-console -- the one sanctioned production console sink; raw value deliberately dropped
    console.error(label, detail);
    return;
  }
  // eslint-disable-next-line no-console -- development builds only; raw value included for debugging
  console.error(label, detail, raw);
}
