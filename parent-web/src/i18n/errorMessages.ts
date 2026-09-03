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

// ---------------------------------------------------------------------------
// Presentation: is this a FAILURE, or is it the system working as designed?
//
// The three codes above are not breakages. `ENDPOINT_NOT_TRUSTED` means the
// trust gate did its job; `NOT_READY_CRYPTO_REVIEW` means an unreviewed crypto
// suite was correctly refused; `NOT_IMPLEMENTED` means a capability is honestly
// not connected yet. Every one of them is a deliberate fail-closed decision.
//
// Until now all three rendered through `ErrorState`, under the headline
// "Something went wrong" with `role="alert"` -- which tells a parent the
// product is broken at the exact moment it is behaving correctly, and (in real
// mode, where `getDashboard()` always throws by design) makes the console look
// permanently broken.
//
// The honest sentences already existed; only the framing was wrong. This
// splits the routing decision out so `States.tsx` can pick between three
// treatments -- action-needed, genuine error, empty -- instead of two.
// ---------------------------------------------------------------------------

/** How a thrown value should be PRESENTED, as opposed to what it says. */
export type ErrorPresentation = 'ACTION_NEEDED' | 'ERROR';

/**
 * The one next step for an `ACTION_NEEDED` condition. A state with no next
 * step is a dead end, so every entry names a route; `null` route means the
 * condition genuinely has no action a parent can take yet (text only).
 */
export interface ActionNeededPlan {
  /** i18n key for the headline. Never "Something went wrong". */
  titleKey: string;
  /** i18n key for the plain-language reason. These are the existing, honest sentences. */
  bodyKey: string;
  /** i18n key for the primary action's label, or null when there is no action. */
  actionLabelKey: string | null;
  /** In-app route the primary action goes to, or null. Never an external URL. */
  actionTo: string | null;
}

const ACTION_NEEDED_PLANS: Readonly<Record<string, ActionNeededPlan>> = {
  // The trust gate refused this browser. The next step is real and specific.
  'errors.endpointNotTrusted': {
    titleKey: 'states.browserSetupNeededTitle',
    bodyKey: 'errors.endpointNotTrusted',
    actionLabelKey: 'states.browserSetupNeededAction',
    actionTo: '/security/trusted-browser',
  },
  // The production crypto suite has not been security-reviewed. A parent
  // cannot fix that, but they can read exactly what it means for them.
  'errors.cryptoReviewRequired': {
    titleKey: 'states.notAvailableYetTitle',
    bodyKey: 'errors.cryptoReviewRequired',
    actionLabelKey: 'states.learnWhat',
    actionTo: '/privacy/transparency',
  },
  // Not connected to the service yet. There is deliberately nothing to click.
  'errors.serviceUnavailable': {
    titleKey: 'states.notConnectedYetTitle',
    bodyKey: 'errors.serviceUnavailable',
    actionLabelKey: null,
    actionTo: null,
  },
};

/**
 * `ACTION_NEEDED` for exactly the three fail-closed conditions above (matched
 * by `code`, or by class `name` for an error that lost its discriminant across
 * a module realm). `ERROR` for everything else -- including an unrecognised
 * throw, which must stay a genuine error rather than be softened into
 * reassuring copy.
 */
export function errorPresentation(error: unknown): ErrorPresentation {
  return userFacingErrorKey(error) === null ? 'ERROR' : 'ACTION_NEEDED';
}

/**
 * The headline / reason / next-step triple for an `ACTION_NEEDED` condition,
 * or `null` when `error` is a genuine failure and belongs in `ErrorState`.
 */
export function actionNeededPlan(error: unknown): ActionNeededPlan | null {
  const key = userFacingErrorKey(error);
  if (key === null) return null;
  return ACTION_NEEDED_PLANS[key] ?? null;
}

/**
 * The same decision, made from the already-localized sentence instead of the
 * cause.
 *
 * `hooks/useAsync.ts` deliberately hands its callers `describeUserFacingError`
 * output rather than the thrown value, so the ~30 pages that render
 * `<ErrorState message={error} />` never see the cause at all. Rather than
 * change that hook's contract (and every page with it) just to reframe three
 * conditions, the sentence is matched back to its key here: all three come out
 * of the same bundle as `t(key)`, so the comparison is exact, and an
 * unrecognised sentence correctly falls through to the genuine-error path.
 *
 * A page that DOES hold the thrown value should call `actionNeededPlan`
 * instead -- it is the direct route and does not depend on copy.
 */
export function actionNeededPlanForMessage(message: string, t: TFunction): ActionNeededPlan | null {
  for (const [key, plan] of Object.entries(ACTION_NEEDED_PLANS)) {
    if (t(key) === message) return plan;
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
