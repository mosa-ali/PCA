// Shared gate for family content that must remain unreadable until the
// approved client crypto suite is ready. Parent session authority is
// enforced by the API routes; a browser endpoint is not Parent authority.
import { getCryptoGateDecision, CryptoReviewRequiredError } from '@pca/parent-sdk-browser-runtime';

/** Throws CryptoReviewRequiredError until the reviewed family-content crypto suite is ready. */
export async function requireFamilyCryptoReady(operation: string): Promise<void> {
  const gate = getCryptoGateDecision();
  if (gate.status !== 'READY') {
    throw new CryptoReviewRequiredError(operation);
  }
}
