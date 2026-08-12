// Shared gating helper for every real provider that exposes decrypted
// family content (RealParentFamilyDataGateway, RealDeviceStatusClient,
// RealRequestClient). Order of checks mirrors
// @pca/parent-sdk-browser-runtime's attemptDecrypt: endpoint trust is
// checked before the crypto gate, so an untrusted/revoked endpoint is
// rejected on its own terms rather than being lumped into a generic
// "crypto not ready" message.
import { getCryptoGateDecision, CryptoReviewRequiredError } from '@pca/parent-sdk-browser-runtime';
import type { TrustedBrowserProvider } from '../../domain/trustedBrowser';
import { EndpointNotTrustedError } from '../familyDataAccessErrors';

/** Throws EndpointNotTrustedError or CryptoReviewRequiredError; resolves (void) only when both checks pass. */
export async function requireTrustedAndCryptoReady(
  trustedBrowser: TrustedBrowserProvider,
  operation: string,
): Promise<void> {
  const snapshot = await trustedBrowser.getSnapshot();
  if (snapshot.state !== 'TRUSTED') {
    throw new EndpointNotTrustedError(snapshot.state, operation);
  }
  const gate = getCryptoGateDecision();
  if (gate.status !== 'READY') {
    throw new CryptoReviewRequiredError(operation);
  }
}
