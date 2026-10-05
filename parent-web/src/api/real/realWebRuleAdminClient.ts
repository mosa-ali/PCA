// This adapter intentionally remains unavailable. PCA-SEC-023 classifies
// filter lists as family plaintext: generic family-crypto readiness does
// not define an encrypted Web Rules payload, persistence contract, or
// delivery path. Do not send readable {domain, listType} DTOs from Parent.
// Replace this stub only with a reviewed opaque E2EE storage/delivery flow.
import type { WebRuleAdminClient } from '../interfaces';
import type { WebRuleDeliveryStatus, WebRuleEntry, WebRuleListType } from '../../domain/webRulePolicy';
import { ServiceUnavailableError } from '../unavailable';
import { requireFamilyCryptoReady } from './familyDataGate';

export class RealWebRuleAdminClient implements WebRuleAdminClient {
  async listRules(_childId: string): Promise<{ rules: WebRuleEntry[]; status: WebRuleDeliveryStatus; revision: number | null }> {
    return this.rejectUntilEncryptedContract('listRules');
  }

  async setRule(_childId: string, _domain: string, _listType: WebRuleListType): Promise<{ rules: WebRuleEntry[]; status: WebRuleDeliveryStatus }> {
    return this.rejectUntilEncryptedContract('setRule');
  }

  async removeRule(_childId: string, _domain: string, _listType: WebRuleListType): Promise<{ rules: WebRuleEntry[]; status: WebRuleDeliveryStatus }> {
    return this.rejectUntilEncryptedContract('removeRule');
  }

  private async rejectUntilEncryptedContract(operation: string): Promise<never> {
    const name = `WebRuleAdminClient.${operation}`;
    // Keep the general family-content gate, but do not mistake it for Web
    // Rules encryption approval. Even a READY result cannot authorize a
    // cleartext route or DTO.
    await requireFamilyCryptoReady(name);
    throw new ServiceUnavailableError(name);
  }
}
