// PCA-MYKIDS-BILL-3: a real payment-provider handoff means the browser may
// do a genuine full-page navigation away from this SPA and back (see
// isSameOriginRedirect in ./billing.ts) -- any in-memory React state from
// before the redirect is gone by the time the provider returns the browser.
// sessionStorage is same-origin and survives that round trip, so it is used
// ONLY to correlate a requestId with the paymentAttemptId the checkout-CREATE
// response returned -- never to store payment status/outcome itself (that is
// always re-read live from the server via getCheckoutStatus/getRequest, per
// PCA-ADD-BILL-035: a browser return proves nothing on its own).
const STORAGE_PREFIX = 'pca-checkout-attempt:';

function storageKey(requestId: string): string {
  return `${STORAGE_PREFIX}${requestId}`;
}

export function storePaymentAttemptId(requestId: string, paymentAttemptId: string): void {
  try {
    window.sessionStorage.setItem(storageKey(requestId), paymentAttemptId);
  } catch {
    // Best-effort only (e.g. private-browsing storage denial) -- the UI
    // still works via getRequest polling alone if this fails.
  }
}

export function getStoredPaymentAttemptId(requestId: string): string | null {
  try {
    return window.sessionStorage.getItem(storageKey(requestId));
  } catch {
    return null;
  }
}
