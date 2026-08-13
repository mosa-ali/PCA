// Real (non-fixture) WebRuleAdminClient. doc 35: production Parent Web rule
// mutation must respect the trusted-browser/crypto gate -- every method is
// gated by requireTrustedAndCryptoReady before it would ever construct or
// send a family Web Rule payload, matching RealParentFamilyDataGateway's
// convention exactly. Since the production crypto suite is not yet
// approved (see @pca/parent-sdk-browser-runtime's cryptoGate.ts), every
// call here rejects with EndpointNotTrustedError or
// CryptoReviewRequiredError today -- honest, not a bug. No plaintext family
// web rule is ever sent to a central service by this class (doc 35): there
// is no HTTP call anywhere in this file.
import type { WebRuleAdminClient } from '../interfaces';
import type { WebRuleDeliveryStatus, WebRuleEntry, WebRuleListType } from '../../domain/webRulePolicy';
import type { TrustedBrowserProvider } from '../../domain/trustedBrowser';
import { requireTrustedAndCryptoReady } from './familyDataGate';

export class RealWebRuleAdminClient implements WebRuleAdminClient {
  constructor(private readonly trustedBrowser: TrustedBrowserProvider) {}

  async listRules(childId: string): Promise<{ rules: WebRuleEntry[]; status: WebRuleDeliveryStatus; revision: number | null }> {
    await requireTrustedAndCryptoReady(this.trustedBrowser, 'WebRuleAdminClient.listRules');
    throw new Error(`WebRuleAdminClient.listRules: no decrypted web-rule record is cached yet for child "${childId}".`);
  }

  async setRule(childId: string, _domain: string, _listType: WebRuleListType): Promise<{ rules: WebRuleEntry[]; status: WebRuleDeliveryStatus }> {
    await requireTrustedAndCryptoReady(this.trustedBrowser, 'WebRuleAdminClient.setRule');
    throw new Error(`WebRuleAdminClient.setRule: mutation path not implemented yet even post-crypto-approval (child "${childId}").`);
  }

  async removeRule(childId: string, _domain: string, _listType: WebRuleListType): Promise<{ rules: WebRuleEntry[]; status: WebRuleDeliveryStatus }> {
    await requireTrustedAndCryptoReady(this.trustedBrowser, 'WebRuleAdminClient.removeRule');
    throw new Error(`WebRuleAdminClient.removeRule: mutation path not implemented yet even post-crypto-approval (child "${childId}").`);
  }
}
