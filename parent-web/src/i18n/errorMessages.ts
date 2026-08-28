// The single place that turns a thrown error into a sentence a PARENT should
// read. Before this existed, hooks/useAsync.ts pushed `err.message` straight
// into States.tsx's ErrorState, so the copy a parent actually saw was
// developer prose with internal identifiers in it, always in English:
//
//   "EnvelopeDecryptor.decrypt requires the production E2EE crypto suite,
//    which has not been human-security-reviewed and approved yet (see
//    src/cryptoGate.ts). ..."                (CryptoReviewRequiredError)
//   "ParentFamilyDataGateway.getDashboard requires a TRUSTED browser
//    endpoint; current state is BROWSER_NOT_TRUSTED. ..."
//                                            (EndpointNotTrustedError)
//   "FamilyAuthorityGateway.listMembers has no real (non-fixture) backend
//    implementation yet in this repository slice. ..."
//                                            (ServiceUnavailableError)
//
// Those messages stay exactly as they are -- they are good diagnostics and
// every one of them is still on the Error object, still logged by callers via
// `errorDiagnosticDetail` below, still visible in the console and in any error
// report. This module only decides what is rendered as the user-facing
// sentence.
//
// Discrimination is by the `code` discriminant each of these error classes
// already carries (falling back to `name`), NOT `instanceof`: the crypto gate
// error class comes from the separately-bundled
// @pca/parent-sdk-browser-runtime package, where an `instanceof` check is not
// reliable across module realms.
import type { TFunction } from 'i18next';

interface DiscriminatedError {
  name?: unknown;
  code?: unknown;
  message?: unknown;
}

/** code -> i18n key for the error types this app can describe honestly. */
const KNOWN_ERROR_MESSAGE_KEYS: Readonly<Record<string, string>> = {
  NOT_READY_CRYPTO_REVIEW: 'errors.cryptoReviewRequired',
  ENDPOINT_NOT_TRUSTED: 'errors.endpointNotTrusted',
  NOT_IMPLEMENTED: 'errors.serviceUnavailable',
};

/** Error class name -> the same keys, for an error that lost its `code`. */
const KNOWN_ERROR_NAME_KEYS: Readonly<Record<string, string>> = {
  CryptoReviewRequiredError: 'errors.cryptoReviewRequired',
  EndpointNotTrustedError: 'errors.endpointNotTrusted',
  ServiceUnavailableError: 'errors.serviceUnavailable',
};

/** The i18n key for `error`, or `null` when it is not a type we can name. */
export function userFacingErrorKey(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as DiscriminatedError;
  if (typeof candidate.code === 'string' && KNOWN_ERROR_MESSAGE_KEYS[candidate.code]) {
    return KNOWN_ERROR_MESSAGE_KEYS[candidate.code];
  }
  if (typeof candidate.name === 'string' && KNOWN_ERROR_NAME_KEYS[candidate.name]) {
    return KNOWN_ERROR_NAME_KEYS[candidate.name];
  }
  return null;
}

/**
 * Localized, user-appropriate copy for `error`. Falls back to a localized
 * generic sentence for anything this app cannot describe precisely -- never
 * to the raw `err.message`, which is developer prose and hardcoded English.
 */
export function describeUserFacingError(error: unknown, t: TFunction): string {
  return t(userFacingErrorKey(error) ?? 'errors.unknown');
}

/**
 * The original developer-facing detail, preserved for console/debug use. This
 * is deliberately NOT rendered anywhere -- it is what a developer reads in the
 * console when a parent reports "it just says something went wrong".
 */
export function errorDiagnosticDetail(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (error && typeof error === 'object') {
    const candidate = error as DiscriminatedError;
    if (typeof candidate.message === 'string') return candidate.message;
  }
  return String(error);
}
